Tôi muốn bạn DEBUG và sửa một POC Node.js dùng:

YuNet:
face_detection_yunet_2023mar.onnx

SFace:
face_recognition_sface_2021dec.onnx

MỤC TIÊU DUY NHẤT CỦA TASK NÀY:

Xác định chính xác tại sao YuNet đang tạo ra bounding box và facial landmarks không khớp với nhau, xác định chính xác đoạn code sai, sau đó sửa đúng đoạn code đó để pipeline detection hoạt động đúng.

KHÔNG được bắt đầu bằng việc tune:

minConfidence
nmsThreshold
minFaceSize

Đây không phải mục tiêu hiện tại.

============================================================
HIỆN TƯỢNG
============================================================

Một detection hiện tại:

box:
x=1170
y=619
w=32
h=40

=> box:

left=1170
top=619
right=1202
bottom=659

Nhưng landmarks:

1108,561
1188,561
1147,588
1116,612
1183,612

Các landmarks này phần lớn nằm ngoài bounding box.

Một detection khác:

box:
567,437,37x64

landmarks:

524,472
604,473
569,503
528,525
594,528

Cũng có landmarks nằm ngoài box.

Đặc biệt nhiều detection khác nhau có landmarks gần như giống nhau:

0.827:
1108,561 | 1188,561 | 1147,588 | 1116,612 | 1183,612

0.816:
1107,562 | 1186,561 | 1148,588 | 1120,613 | 1184,612

0.792:
1109,560 | 1189,559 | 1148,587 | 1115,613 | 1182,610

trong khi bounding box khác nhau đáng kể.

Đây là hiện tượng cần giải thích.

============================================================
NHIỆM VỤ
============================================================

Bạn phải kiểm tra pipeline theo đúng thứ tự:

1. YuNet RAW OUTPUT
2. YuNet DECODE
3. 640x640 COORDINATE SYSTEM
4. LETTERBOX TRANSFORM
5. SOURCE COORDINATE SYSTEM
6. BOUNDING BOX vs LANDMARK GEOMETRY
7. LANDMARK ORDER
8. ALIGNMENT
9. NMS
10. FINAL FILTER

Không được bỏ qua bước nào.

============================================================
BƯỚC 1 — KIỂM TRA RAW YUNET
============================================================

Kiểm tra chính xác output của:

face_detection_yunet_2023mar.onnx

Hiện tại code sử dụng:

cls_8
obj_8
bbox_8
kps_8

và:

cls_16
obj_16
bbox_16
kps_16

và:

cls_32
obj_32
bbox_32
kps_32

Xác định chính xác:

- cls có ý nghĩa gì?
- obj có ý nghĩa gì?
- bbox có encoding gì?
- kps có encoding gì?
- confidence có phải cls * obj không?
- bbox có cần stride không?
- kps có cần stride không?

ĐỐI CHIẾU VỚI IMPLEMENTATION CHUẨN CỦA YUNET 2023MAR.

Không được đoán.

============================================================
BƯỚC 2 — KIỂM TRA decodeDetections()
============================================================

Kiểm tra đoạn:

confidence = scores[index] * objects[index]

Kiểm tra:

landmarkX =
(column + keypoints[...]) * stride

landmarkY =
(row + keypoints[...]) * stride

Kiểm tra:

left =
(column - boxes[offset]) * stride

top =
(row - boxes[offset + 1]) * stride

right =
(column + boxes[offset + 2]) * stride

bottom =
(row + boxes[offset + 3]) * stride

Đối với MỖI công thức:

Trả lời:

CORRECT hoặc WRONG.

Nếu WRONG:

- giải thích vì sao
- đưa công thức chính xác
- chỉ đúng dòng code cần sửa

============================================================
BƯỚC 3 — DEBUG BẰNG CHỨNG
============================================================

Thêm DEBUG cho một candidate:

stride
index
row
column

raw cls
raw obj
raw confidence

raw bbox[0..3]

raw kps[0..9]

decoded bbox 640x640

decoded landmarks 640x640

Không làm tròn quá sớm.

============================================================
BƯỚC 4 — KIỂM TRA LETTERBOX
============================================================

Code hiện tại:

const detectorScale = Math.min(
  detectorSize / width,
  detectorSize / height
);

const detectorOffsetX =
  Math.round((detectorSize - detectorWidth) / 2);

const detectorOffsetY =
  Math.round((detectorSize - detectorHeight) / 2);

Sau đó:

sharp.resize(640,640,{fit:"contain"})

Kiểm tra xem:

detectorScale
detectorOffsetX
detectorOffsetY

có chính xác với ảnh thực tế mà Sharp tạo ra hay không.

Đặc biệt kiểm tra vấn đề ROUNDING.

============================================================
BƯỚC 5 — KIỂM TRA TRANSFORM
============================================================

Hiện tại box được chuyển:

sourceX = (detectorX - detectorOffsetX) / detectorScale

sourceY = (detectorY - detectorOffsetY) / detectorScale

Kiểm tra công thức này.

Landmarks cũng được chuyển bằng:

x = (point.x - detectorOffsetX) / detectorScale
y = (point.y - detectorOffsetY) / detectorScale

Kiểm tra công thức này.

QUAN TRỌNG:

Chứng minh bằng số liệu rằng một candidate:

640x640 coordinates

sau transform thành:

source coordinates

vẫn giữ đúng quan hệ hình học.

============================================================
BƯỚC 6 — KIỂM TRA BOX VS LANDMARK
============================================================

Sau khi decode và sau khi transform, với mỗi detection tính:

box:
left
top
right
bottom

landmark:
P0
P1
P2
P3
P4

Kiểm tra P0-P4 có nằm trong hoặc gần bounding box không.

In:

P0 inside=true/false
P1 inside=true/false
...

Nếu landmark nằm ngoài:

in ra khoảng cách nó nằm ngoài box.

MỤC TIÊU:

Xác định chính xác tại bước nào quan hệ:

BOX ↔ LANDMARK

bị phá vỡ.

============================================================
BƯỚC 7 — KIỂM TRA LANDMARK ORDER
============================================================

Xác định chính xác YuNet trả 5 landmarks theo thứ tự nào.

Code hiện tại đảo:

[
 sourcePoints[1],
 sourcePoints[0],
 sourcePoints[2],
 sourcePoints[4],
 sourcePoints[3]
]

Trước khi dùng ALIGNMENT_TEMPLATE.

Kiểm tra xem việc đảo này có đúng không.

Nếu sai:

chỉ ra chính xác thứ tự đúng.

============================================================
BƯỚC 8 — KIỂM TRA ALIGNMENT
============================================================

Kiểm tra:

similarityTransform()

và:

sampleAligned()

Mục tiêu:

Nếu box và landmarks đã đúng thì aligned 112x112 phải chứa đúng khuôn mặt.

Không được sửa alignment trước khi chứng minh detection coordinates đúng.

============================================================
BƯỚC 9 — KIỂM TRA NMS
============================================================

In:

raw candidates
after confidence filtering
after NMS

Với các candidate bị suppress:

score A
box A
score B
box B
IoU
nmsThreshold
decision

Mục tiêu:

Xác định có phải NMS làm mất các khuôn mặt thật hay không.

============================================================
BƯỚC 10 — PHÂN LOẠI NGUYÊN NHÂN
============================================================

Sau khi kiểm tra xong, BẮT BUỘC phân loại lỗi vào một trong các nhóm sau:

A. YuNet decode sai

B. BBox decode sai

C. Landmark decode sai

D. Letterbox transform sai

E. Source coordinate transform sai

F. Landmark ordering sai

G. Alignment sai

H. NMS sai

I. Filtering sai

J. YuNet thực sự không detect được khuôn mặt

Nếu có nhiều lỗi, sắp xếp theo thứ tự nguyên nhân gốc.

============================================================
KẾT QUẢ BẮT BUỘC
============================================================

KHÔNG được kết thúc bằng:

"có thể là..."
"có khả năng..."
"nên thử..."
"hãy tune threshold..."

Bạn phải đưa ra kết luận dựa trên bằng chứng.

Format cuối cùng BẮT BUỘC:

ROOT CAUSE
----------------
[nguyên nhân chính xác]

EVIDENCE
----------------
[những DEBUG nào chứng minh điều đó]

WRONG CODE
----------------
[đoạn code hiện tại]

CORRECT CODE
----------------
[đoạn code đã sửa]

WHY
----------------
[giải thích toán học/nguyên lý]

EXPECTED RESULT
----------------
[sau khi sửa thì box/landmarks phải thay đổi như thế nào]

SECONDARY ISSUES
----------------
[nếu còn vấn đề khác]

============================================================
QUY TẮC QUAN TRỌNG
============================================================

1. Không thay đổi minConfidence=0.75 để giải quyết lỗi.

2. Không thay đổi nmsThreshold=0.5 để giải quyết lỗi.

3. Không thay đổi minFaceSize=20 để giải quyết lỗi.

4. Không sửa SFace.

5. Không sửa clustering.

6. Không viết lại project.

7. Chỉ sửa những dòng liên quan trực tiếp đến nguyên nhân đã được chứng minh.

8. Nếu chưa đủ bằng chứng để kết luận, phải nói rõ:

INCONCLUSIVE

và chỉ ra chính xác DEBUG nào còn thiếu.

9. Nếu xác định được lỗi, hãy sửa code và trả lại phiên bản hàm hoàn chỉnh đã sửa.

MỤC TIÊU CUỐI CÙNG:

Tôi không cần thêm một đống DEBUG.

Tôi cần biết chính xác:

"BUG NẰM Ở ĐÂU, VÌ SAO SAI, VÀ PHẢI SỬA DÒNG NÀO."

Sau khi sửa, detection phải có quan hệ hình học hợp lý:

bounding box
    ↓
5 landmarks
    ↓
đúng cùng một khuôn mặt
    ↓
alignment 112x112
    ↓
SFace

Đó mới là tiêu chí thành công của task này.

YuNet RAW
   │
   ▼
decode
   │
   ├── BOX ─────────┐
   │                │
   └── LANDMARK ────┤
                    ▼
             CÙNG MỘT FACE?
                    │
                    ▼
              transform
                    │
                    ▼
             CÙNG TỌA ĐỘ?
                    │
                    ▼
              alignment
                    │
                    ▼
                SFace