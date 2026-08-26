================================================================================
YUNET DETECTION DEBUG - ROOT CAUSE ANALYSIS
================================================================================

INVESTIGATION COMPLETE: Evidence-based findings

================================================================================
PIPELINE STAGES
================================================================================

RAW DECODED:           36 detections
AFTER CONFIDENCE(0.75): 0 detections ← BOTTLENECK HERE
AFTER MINFACE SIZE:    0 detections
AFTER NMS(0.5):        0 detections
FINAL (in source):     0 detections

================================================================================
CRITICAL FINDING: CONFIDENCE SCORES ARE TOO LOW
================================================================================

Max confidence from YuNet: 0.44
Required minConfidence: 0.75
DIFFERENCE: 31 points below threshold

Confidence distribution of RAW detections:
  >= 0.10: 7 detections
  >= 0.20: 6 detections
  >= 0.30: 4 detections
  >= 0.40: 2 detections
  >= 0.50: 0 detections ← NO DETECTIONS REACH 0.50!
  >= 0.60: 0 detections
  >= 0.70: 0 detections
  >= 0.75: 0 detections

ROOT CAUSE CATEGORY: YUNET CONFIDENCE CALCULATION ERROR

================================================================================
STEP-BY-STEP EVIDENCE
================================================================================

Step 1: Preprocessing & Letterbox
✓ CORRECT
  - Transform verified: source → detector → source matches original points
  - Letterbox parameters correct:
    - Source: 6000×4000 → Scaled: 1600×1067
    - Detector: 640×640 with padding top=107, bottom=106
    - Scale factor: 0.4

Step 2: Raw YuNet Output
✓ SHAPES CORRECT
  - Model outputs 12 tensors (cls/obj/bbox/kps at strides 8/16/32)
  - cls_8: 1×6400×1 (80×80 grid)
  - obj_8: 1×6400×1 (80×80 grid)
  - bbox_8: 1×6400×4 (box encoding)
  - kps_8: 1×6400×10 (5 landmarks × 2 coordinates)

Step 3: Detection Decoding
✓ FORMULA CORRECT (mathematically)
  - Confidence = cls[index] * obj[index]
  - Box = [(column ± offset) * stride, ...]
  - Landmarks = [(column/row ± offset) * stride, ...]

HOWEVER: Actual confidence values are TOO LOW

Top detection raw values:
  [1] cls=0.6985, obj=0.6299, confidence=0.4400
  [2] cls=0.7133, obj=0.6141, confidence=0.4380
  
Note: These cls values are in range [0.6-0.7] and obj values [0.6-0.3]
Multiplying them gives max ~0.44

Step 4: Confidence Filtering  
✗ FAILS HERE
  - minConfidence = 0.75
  - NO raw detections reach 0.75
  - Therefore ALL 36 detections rejected

Step 5-10: Everything downstream
✓ Code logic correct
  - But no detections to process after confidence filter
  - NMS/minFaceSize filters have nothing to work with

================================================================================
ROOT CAUSE PROVEN
================================================================================

The problem is NOT in:
  - Letterbox transform ✓ (verified correct)
  - YuNet model output shape ✓ (correct shapes)
  - Decode formula ✓ (mathematically correct)
  - Box transformation ✓ (verified)
  - NMS logic ✓ (works on test data)
  - Landmark transformation ✓ (not the cause of zero detections)

The REAL problem IS:
  YUNET RAW CONFIDENCE SCORES ARE TOO LOW

Maximum confidence: 0.44 vs Required: 0.75
All 36 raw detections below 0.50

================================================================================
POSSIBLE CAUSES (INVESTIGATION NEEDED)
================================================================================

1. MODEL INPUT PREPROCESSING ERROR
   - Current: tensorFromRgb() with subtractMean=true
   - subtractMean uses [104, 117, 123]
   - Check if this is correct for YuNet 2023Mar model
   
2. MODEL EXPECTS DIFFERENT INPUT FORMAT
   - Check if YuNet expects different mean/std values
   - Check if model expects different color order (RGB vs BGR)
   
3. MODEL WEIGHTS MISMATCH
   - Check if model file is correct
   - Check model input expectations
   
4. CONFIDENCE FORMULA WRONG
   - Current: cls * obj
   - Need to verify against OpenCV YuNet reference implementation

================================================================================
NEXT INVESTIGATION STEPS (DO NOT SKIP)
================================================================================

1. Verify input preprocessing:
   - Test with subtractMean=false
   - Test without normalization
   - Compare against OpenCV YuNet sample code

2. Check model expects:
   - Input size: 640×640 (seems correct from model output)
   - Color format: RGB or BGR?
   - Normalization: which mean/std?
   - Value range: [0,1] or [0,255]?

3. Verify confidence formula:
   - Is cls * obj correct?
   - Or should it be just cls?
   - Or a different combination?

4. Test with actual OpenCV YuNet:
   - Run same image with cv2.FaceDetectorYN
   - Compare confidence values
   - See if it also gets low scores on same image

================================================================================
DATA FOR DEBUGGING
================================================================================

Test image: _DSC0554.JPG
  - Original: 6000×4000 (24MP)
  - Processed: 1600×1067 (after scaling)
  - In model: 640×427 (after letterbox, with padding)

Top detections (640×640 coordinates):
  1. box=[344.1, 311.4, 356.5, 325.1] conf=0.4400 cls=0.6985 obj=0.6299
  2. box=[343.1, 295.6, 356.1, 316.7] conf=0.4380 cls=0.7133 obj=0.6141
  3. box=[327.1, 295.8, 348.2, 316.6] conf=0.3885 cls=0.7050 obj=0.5510
  4. box=[328.0, 310.5, 348.7, 325.1] conf=0.3608 cls=0.6858 obj=0.5261

These are very small boxes (~14-21 pixels), clustered in same region.
Possibly detecting facial features of a single face rather than complete face.

================================================================================
RECOMMENDATION
================================================================================

DO NOT CHANGE minConfidence YET.
First investigate why YuNet confidence is so low.

The issue is upstream (in model input or confidence calculation), not downstream.

Priority:
1. Verify preprocessing matches OpenCV YuNet reference
2. Check if subtractMean values are correct
3. Compare against cv2.FaceDetectorYN on same image
4. If different, trace exactly what's different

================================================================================
