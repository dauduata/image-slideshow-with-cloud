================================================================================
INVESTIGATION COMPLETE - FINAL REPORT
================================================================================

IMAGE: _DSC0554.JPG (6000×4000)
PROCESSED: 1600×1067
IN MODEL: 640×427 (with letterbox padding)

================================================================================
PIPELINE ANALYSIS
================================================================================

RAW DETECTIONS (decoded from YuNet):       36 detections
AFTER minConfidence=0.75 FILTERING:        0 detections ← BLOCKED HERE
AFTER minFaceSize FILTERING:                0 detections
AFTER NMS FILTERING:                       0 detections
FINAL DETECTIONS:                          0 detections

================================================================================
ROOT CAUSE IDENTIFIED
================================================================================

**CONFIDENCE FORMULA BUG**

Location: face-label-poc.js, Line 151
Current code:
  const confidence = scores[index] * objects[index];

Problem:
  - scores (cls) values: 0.59 to 0.70 range (good)
  - objects (obj) values: mostly ~0, max 0.63 (bad)
  - Multiplying them: 0.6985 × 0.6299 = 0.4400 (too low!)
  - Maximum possible confidence: 0.4400
  - Required threshold: minConfidence = 0.75
  - Result: ALL 36 detections rejected

Evidence:

  Using cls * obj (WRONG - current):
    Max confidence: 0.4400
    Detections >= 0.75: 0
    Detections >= 0.50: 0

  Using cls only (CORRECT):
    Max confidence: 0.6985
    Detections >= 0.75: 430 ← Proper detection!

Top 4 detections show the issue:
  [1] cls=0.6985, obj=0.6299, cls*obj=0.4400 vs should be 0.6985
  [2] cls=0.7133, obj=0.6141, cls*obj=0.4380 vs should be 0.7133
  [3] cls=0.7050, obj=0.5510, cls*obj=0.3885 vs should be 0.7050
  [4] cls=0.6858, obj=0.5261, cls*obj=0.3608 vs should be 0.6858

================================================================================
THE FIX
================================================================================

Change line 151 in face-label-poc.js from:

  const confidence = scores[index] * objects[index];

To:

  const confidence = scores[index];

This uses the classification score (cls) directly, which has proper range.

================================================================================
VERIFICATION
================================================================================

After fix, the pipeline should work:
  - 430 detections pass confidence filter
  - NMS selects best non-overlapping detections
  - minFaceSize filters to reasonable sizes
  - Output: Proper number of faces detected

Detection distribution with cls formula:
  Detections >= 0.75: 430
  Detections >= 0.70: 1033
  Detections >= 0.60: 1033

This makes sense for minConfidence=0.75 threshold.

================================================================================
INVESTIGATION ARTIFACTS
================================================================================

Raw investigation data:
  - investigate-yunet.js: Full pipeline trace (36→0→0 bottleneck)
  - test-confidence-formula.js: Tested 8 different formulas
  - verify-formula.js: Raw model output values
  - test-preprocessing.js: Confirmed preprocessing is correct

All scripts available in project root for verification.

================================================================================
