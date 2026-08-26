================================================================================
YUNET DETECTION PIPELINE DEBUG REPORT
================================================================================

TASK: Xác định tại sao YuNet tạo bounding box và facial landmarks không khớp

================================================================================
ROOT CAUSE
================================================================================

Landmarks KHÔNG ĐƯỢC CLIPPED trong khi Bounding Box ĐƯỢC CLIPPED khi transform
từ hệ tọa độ detector 640x640 về hệ tọa độ ảnh source.

Đây là lỗi geometric consistency gây ra misalignment giữa box và landmarks.

================================================================================
EVIDENCE
================================================================================

STEP 1: YuNet RAW OUTPUT
✓ Xác nhận YuNet trả 12 outputs:
  - cls_8, cls_16, cls_32 (classification score per cell, 1 value mỗi cell)
  - obj_8, obj_16, obj_32 (objectness score per cell, 1 value mỗi cell)
  - bbox_8, bbox_16, bbox_32 (bounding box 4 values per cell)
  - kps_8, kps_16, kps_32 (5 landmarks × 2 coordinates = 10 values per cell)

Confidence công thức: confidence = cls * obj ✓ CORRECT

STEP 2-3: DECODE DETECTIONS
✓ Bounding box decode công thức đúng:
  left = (column - boxes[0]) * stride
  top = (row - boxes[1]) * stride
  right = (column + boxes[2]) * stride
  bottom = (row + boxes[3]) * stride

✓ Landmarks decode công thức đúng:
  x = (column + keypoints[i*2]) * stride
  y = (row + keypoints[i*2+1]) * stride

Cả hai đều ở tọa độ 640x640, từ cell (column, row) như anchor.

STEP 4: LETTERBOX TRANSFORM
✓ Letterbox calculation đúng:
  detectorScale = min(640/width, 640/height)
  detectorOffsetX = round((640 - detectorWidth) / 2)
  detectorOffsetY = round((640 - detectorHeight) / 2)

STEP 5: SOURCE COORDINATE TRANSFORM

BUG FOUND!

Dòng 349-353 (Box Transform):
  const left = Math.max(0, toSourceX(detection.left));      ← CLIPPED
  const top = Math.max(0, toSourceY(detection.top));        ← CLIPPED
  const right = Math.min(width, toSourceX(detection.right)); ← CLIPPED
  const bottom = Math.min(height, toSourceY(detection.bottom)); ← CLIPPED

Dòng 376-378 (Landmarks Transform - BEFORE FIX):
  const landmarks = detection.landmarks.map((point) => ({
    x: (point.x - detectorOffsetX) / detectorScale,  ← NO CLIPPING!
    y: (point.y - detectorOffsetY) / detectorScale,  ← NO CLIPPING!
  }));

DIFFERENCE: Box được clipped, Landmarks KHÔNG được clipped!

STEP 6: BOX vs LANDMARK GEOMETRY CHECK

Hiện tượng: Landmarks nằm NGOÀI Bounding Box

Khi ảnh được letterbox vào 640x640 với padding đen:
  
  Ví dụ: ảnh 600×400 scaled thành:
    • detectorScale = 640/600 = 1.067 (fit theo width)
    • detectorWidth = 640, detectorHeight = 427
    • detectorOffsetY = (640-427)/2 = 106 (padding trên/dưới)

  Detection box có thể nằm ở region padding (y < 106 hoặc y > 106+427):
    • Box transform: (y - 106) / 1.067 = NÂN DƯƠNG hoặc > 400
    • Box clipping: Math.max(0, ...) hoặc Math.min(400, ...)
    • Box kết quả: Clipped vào [0, 400]
  
  Landmarks cùng detection:
    • Landmark ở (y = 50) ở detector image (padding area)
    • Landmark transform: (50 - 106) / 1.067 = -52.7 (ÂM!)
    • Landmark clipping: KHÔNG CÓ! 
    • Landmark kết quả: -52.7 (outside ảnh!)

RESULT: 
  • Box: Clipped vào [0, width] → nhỏ hơn detection bbox
  • Landmarks: Không clipped → nằm ngoài clipped box
  • Geometric misalignment!

================================================================================
WRONG CODE
================================================================================

Vị trí: face-label-poc.js, dòng 373-377

```javascript
// 🔴 [J] LANDMARKS THỰC TẾ DÙNG CHO ALIGNMENT
const landmarks = detection.landmarks.map((point) => ({
  x: (point.x - detectorOffsetX) / detectorScale,
  y: (point.y - detectorOffsetY) / detectorScale,
}));
```

Vấn đề:
- Landmarks transform mà không clipping
- Box ở dòng 349-353 có clipping
- Kết quả: Inconsistent geometric behavior

================================================================================
CORRECT CODE
================================================================================

Vị trí: face-label-poc.js, dòng 373-377

```javascript
// 🔴 [J] LANDMARKS THỰC TẾ DÙNG CHO ALIGNMENT
// FIX: Clipping landmarks giống như box để maintain geometric consistency
const landmarks = detection.landmarks.map((point) => ({
  x: Math.max(0, Math.min(width, (point.x - detectorOffsetX) / detectorScale)),
  y: Math.max(0, Math.min(height, (point.y - detectorOffsetY) / detectorScale)),
}));
```

Giải thích:
- Math.max(0, ...) đảm bảo không âm
- Math.min(width/height, ...) đảm bảo không vượt ảnh
- Giống công thức của box (dòng 349-353)
- Maintains geometric consistency

================================================================================
WHY
================================================================================

Toán học Transform:

Khi letterbox ảnh source (w×h) vào detector (640×640):
  • Scale: s = min(640/w, 640/h)
  • Padding: offset_x = (640 - w*s) / 2, offset_y = (640 - h*s) / 2
  • Detector image: ảnh source scaled s lần, centered với padding đen

Khi transform từ detector (640×640) về source (w×h):
  • Công thức: source = (detector - offset) / s
  
Vấn đề rounding:
  • Detector có thể có coordinates tại padding area (< offset hoặc > offset + size)
  • Khi transform, có thể ra âm hoặc > w/h
  • Phải clipping để keep valid range: [0, w] × [0, h]

Geometric consistency:
  • Box sau clipping: khăn từ [x1_clipped, x2_clipped]
  • Landmarks phải cũng clipped vào [0, w]
  • Nếu không, landmarks có thể outside box

Alignment impact:
  • sampleAligned() dùng landmarks để align khuôn mặt 112×112
  • Nếu landmarks outside box, aligned sample sẽ sai
  • SFace embedding sẽ không chính xác cho khuôn mặt

================================================================================
EXPECTED RESULT
================================================================================

Sau khi sửa:

1. Bounding Box:
   • Clipped vào [0, width] × [0, height]
   • Đúng như cũ

2. Landmarks:
   • Cũng clipped vào [0, width] × [0, height]
   • Không thể negative hoặc > bounds

3. Geometric Relationship:
   • Landmarks luôn nằm trong hoặc trên biên box
   • Hoặc bị clipped cùng nhau với box
   • CONSISTENT!

4. Alignment 112×112:
   • Landmarks được extract từ cropped region
   • Samplealigned() sử dụng correct landmarks
   • Crop sẽ chính xác represent khuôn mặt

5. SFace Embedding:
   • Embedding sẽ chính xác cho correct face
   • Clustering sẽ group cùng khuôn mặt lại nhau
   • Output sẽ accurate

================================================================================
SECONDARY ISSUES
================================================================================

Issue 1: Debug output có công thức sai (dòng 360-362)
  Dòng hiện tại:
    `${((point.x * width) / detectorSize).toFixed(0)}`
  
  Công thức này sai vì:
    • point.x ở 640×640
    • (point.x * width) / 640 không phải transform đúng
    • Công thức đúng: (point.x - detectorOffsetX) / detectorScale
  
  Tuy nhiên, đây CHỈ là debug output, không ảnh hưởng kết quả.
  Nếu cần sửa:
    
  ```javascript
  if (options.debug)
    console.log(
      `DEBUG candidate score=${detection.confidence.toFixed(3)} box=${left},${top},${right - left}x${bottom - top} landmarks=${detection.landmarks
        .map((point) => {
          const lmX = (point.x - detectorOffsetX) / detectorScale;
          const lmY = (point.y - detectorOffsetY) / detectorScale;
          return `${lmX.toFixed(0)},${lmY.toFixed(0)}`;
        }).join("|")}`,
    );
  ```

Issue 2: Landmarks có thể không được round
  Landmarks transform không round, nhưng box transform có round.
  
  Khi: x = (point.x - detectorOffsetX) / detectorScale → float
  
  Tuy nhiên, đây không phải vấn đề chính vì:
    • Rounding/flooring là tùy chọn
    • sampleAligned() có thể handle float coordinates
    • Không ảnh hưởng kết quả geometric

  Recommendation:
    • Keep float landmarks để tăng precision
    • hoặc thêm Math.round() nếu cần integer

================================================================================
TESTING RECOMMENDATION
================================================================================

Để verify fix:

1. Chạy face-label-poc.js với debug option:
   node face-label-poc.js --debug --limit 5
   
   Kỳ vọng:
   • Landmarks phải nằm trong box hoặc bị clipped
   • Mỗi detection phải có valid box size

2. Kiểm tra output annotations:
   • Landmarks circle phải nằm trong box rect
   • Crop 112×112 phải chứa đúng khuôn mặt

3. Kiểm tra clustering:
   • Cùng khuôn mặt phải group lại nhau (cosineDistance < threshold)
   • Accuracy sẽ cải thiện

================================================================================
CONCLUSION
================================================================================

Bug: Landmarks không được clipped trong khi box được clipped
Location: face-label-poc.js, dòng 373-377
Severity: CRITICAL - Ảnh hưởng toàn bộ detection pipeline

Fix: Thêm Math.max(0, Math.min(bounds, ...)) cho landmarks transform
Status: ✓ APPLIED

Impact:
- Box và Landmarks sẽ có geometric consistency
- Alignment 112×112 sẽ chính xác
- SFace embedding sẽ cho kết quả đúng
- Clustering sẽ improve

================================================================================
