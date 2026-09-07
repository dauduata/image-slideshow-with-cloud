# Face Labeling Pipeline

## Mục tiêu

`face-label-poc.js` tải ảnh từ nguồn cloud, phát hiện khuôn mặt bằng YuNet, tạo embedding bằng SFace, gom các khuôn mặt tương tự thành cluster và ghi kết quả ra các file dữ liệu để report sử dụng.

Pipeline không lưu ảnh crop khuôn mặt. Dữ liệu chỉ lưu bounding box, landmarks, confidence, embedding trong quá trình xử lý và nhãn cluster trong output cuối.

## Luồng tổng quát

```text
Cloud image URL
			|
			v
fetchRecordImage()
			|
			v
sharp(buffer).rotate()
			|
			v
Resize giữ nguyên aspect ratio
			|
			v
Raw processing image
			|
			+--> detector preprocessing 640 x 640
			|          |
			|          v
			|      YuNet detections
			|          |
			|          v
			|      bbox/landmarks về processing image
			|
			+--> SFace alignment từ processing pixels
								 |
								 v
						 embedding 128 chiều
								 |
								 v
						 clustering
								 |
								 v
						 image-links-labeled.js
						 report/image-links-clusters.js
```

## Cấu hình mặc định

Các giá trị chính trong `defaults`:

```text
maxDimension: 1600
detector input: 640 x 640
SFace input: 112 x 112
concurrency: 3
threshold: 0.45
minConfidence: 0.75
nmsThreshold: 0.5
minFaceSize: 20
maxFaceAspectRatio: 2.5
```

## Tải ảnh

`fetchRecordImage(record, timeout)` thử tải `record.url` trước.

Nếu URL trả HTTP 403, code fallback sang `record.thumbnailUrl`, đồng thời thay đổi kích thước thumbnail lên khoảng 2400 pixel thông qua các query parameter `width` và `height` nếu các parameter này tồn tại.

Hàm trả về:

```js
{
	buffer,
	source
}
```

`source` cho biết ảnh được lấy từ URL gốc hay từ thumbnail fallback. Buffer này là input duy nhất cho bước xử lý bằng Sharp.

## Normalize orientation và tạo processing image

Pipeline hiện tại trong `detectAndEmbed()` là:

```js
const resized = await sharp(buffer)
	.rotate()
	.resize({
		width: options.maxDimension,
		height: options.maxDimension,
		fit: "inside",
		withoutEnlargement: true,
	})
	.removeAlpha()
	.raw()
	.toBuffer({ resolveWithObject: true });
```

### Ý nghĩa

- `.rotate()` đọc EXIF orientation và tạo ảnh canonical theo hướng hiển thị đúng.
- `.resize({ fit: "inside" })` giới hạn ảnh trong khung `1600 x 1600` nhưng giữ nguyên aspect ratio.
- `withoutEnlargement: true` ngăn ảnh nhỏ bị phóng to.
- `.removeAlpha()` tạo raw RGB không có alpha.
- `.raw()` trả pixel buffer thay vì JPEG/PNG.
- `toBuffer({ resolveWithObject: true })` trả cả pixel data và metadata thực tế của output.

Kích thước processing không được tính bằng EXIF metadata trước orientation. Code lấy trực tiếp từ output:

```js
const width = resized.info.width;
const height = resized.info.height;
```

Vì vậy ba giá trị sau luôn cùng một hệ tọa độ:

```text
resized.data
resized.info.width
resized.info.height
```

Đây là coordinate system của ảnh processing mà detector và alignment sử dụng.

## Ví dụ orientation

### Ảnh landscape, Orientation 1

```text
Input physical: 6000 x 4000
EXIF orientation: 1
Canonical: 6000 x 4000
Processing: 1600 x 1067
```

### Ảnh có EXIF Orientation 8

```text
Input physical: 6000 x 4000
EXIF orientation: 8
Canonical sau rotate: 4000 x 6000
Processing: 1067 x 1600
```

### Ảnh portrait vật lý, không cần xoay

```text
Input physical: 4000 x 6000
EXIF orientation: 1
Canonical: 4000 x 6000
Processing: 1067 x 1600
```

Các kích thước processing được lấy từ output thực tế, nên ảnh portrait do EXIF và ảnh portrait vật lý có cùng aspect ratio sẽ được xử lý giống nhau.

## Preprocessing cho YuNet

YuNet luôn nhận tensor kích thước `640 x 640`.

Ảnh processing được đưa vào khung vuông bằng `fit: "contain"`. Ảnh không bị crop; phần còn lại được thêm nền đen.

Từ processing size, code tính:

```js
const detectorScale = Math.min(
	detectorSize / width,
	detectorSize / height,
);

const detectorWidth = Math.round(width * detectorScale);
const detectorHeight = Math.round(height * detectorScale);

const detectorOffsetX = Math.round(
	(detectorSize - detectorWidth) / 2,
);
const detectorOffsetY = Math.round(
	(detectorSize - detectorHeight) / 2,
);
```

Các biến này có ý nghĩa:

```text
width/height:       processing image
detectorScale:      processing image -> vùng ảnh thật trong 640 x 640
detectorWidth/Height vùng ảnh processing sau scale trong detector canvas
detectorOffsetX/Y:  padding trái/trên trong detector canvas
detectorSize:       640 x 640
```

## Decode detection

`decodeDetections()` đọc output YuNet theo các stride `8`, `16` và `32`.

Với mỗi cell, code giải mã:

- confidence từ class score và object score;
- 5 landmarks;
- tâm bbox;
- width/height bbox;
- left/top/right/bottom.

Các giá trị decode ban đầu thuộc coordinate system detector `640 x 640`.

## Map bbox và landmarks

Detection được chuyển từ detector coordinate về processing coordinate bằng cách bỏ padding rồi chia cho scale:

```js
const toSourceX = (value) =>
	Math.round((value - detectorOffsetX) / detectorScale);

const toSourceY = (value) =>
	Math.round((value - detectorOffsetY) / detectorScale);
```

Bbox được clamp vào processing image:

```js
const left = Math.max(0, toSourceX(detection.left));
const top = Math.max(0, toSourceY(detection.top));
const right = Math.min(width, toSourceX(detection.right));
const bottom = Math.min(height, toSourceY(detection.bottom));
```

Landmarks dùng cùng phép biến đổi nhưng giữ độ chính xác số thực:

```js
const landmarks = detection.landmarks.map((point) => ({
	x: (point.x - detectorOffsetX) / detectorScale,
	y: (point.y - detectorOffsetY) / detectorScale,
}));
```

Sau bước này:

```text
bbox và landmarks
đều thuộc processing coordinate
0 <= x <= width
0 <= y <= height
```

## Validation hình học

Khi bật logging/validation debug, code kiểm tra:

- processing width/height phải lớn hơn 0;
- bbox không vượt khỏi processing image;
- `right >= left` và `bottom >= top`;
- từng landmark nằm trong processing image.

Validation chỉ ghi log. Nó không throw exception và không loại bỏ face.

## Alignment và SFace embedding

Alignment đọc trực tiếp pixel từ `resized.data`:

```js
const aligned = sampleAligned(
	resized.data,
	width,
	height,
	similarityTransform(landmarks),
);
```

`sampleAligned()` lấy mẫu từ processing image và tạo buffer `112 x 112 x 3`. Hàm dùng `width` và `height` để tính stride raw pixel:

```js
source[(y * width + x) * 3 + channel]
```

Do `width` và `height` được lấy từ `resized.info`, chúng khớp với layout của `resized.data`.

Buffer aligned được đưa vào SFace:

```text
112 x 112 x 3
```

SFace trả embedding. Embedding sau đó được normalize về norm gần bằng `1`.

## Lọc face

Face bị bỏ qua nếu:

- bbox không có diện tích hợp lệ;
- cạnh nhỏ nhất nhỏ hơn `minFaceSize`;
- aspect ratio bbox vượt `maxFaceAspectRatio`.

Đây là filtering hiện tại của pipeline trước khi face được lưu vào danh sách `faces`.

## Dữ liệu face được lưu

Mỗi face được lưu trong bộ nhớ với dạng chính:

```js
{
	embedding,
	landmarks,
	box: {
		left,
		top,
		width,
		height,
	},
	imageWidth: width,
	imageHeight: height,
	confidence,
}
```

`box`, `landmarks`, `imageWidth` và `imageHeight` cùng thuộc processing coordinate system.

## Clustering

Pipeline tính cosine distance giữa các embedding rồi dùng complete-linkage clustering.

Các cluster không được phép gộp hai face đến từ cùng một ảnh. Việc gộp dừng khi khoảng cách tốt nhất vượt threshold.

Clustering chỉ sử dụng embedding và image index. Nó không thay đổi bbox hoặc landmarks.

## Output files

### `image-links-labeled.js`

Lưu danh sách ảnh và nhãn person trên mỗi record:

```js
const seriesData = [
	{
		...record,
		persons: ["person-001", "person-002"],
	},
];
```

### `report/image-links-clusters.js`

Lưu dữ liệu report:

```js
const seriesData = [
	{
		...record,
		faceImageSize: {
			width,
			height,
		},
		persons: [
			{
				id,
				confidence,
				box,
				landmarks,
			},
		],
	},
];
```

`faceImageSize` chính là kích thước processing image mà detector đã sử dụng. Nó không phải kích thước detector `640 x 640` và cũng không phải kích thước ảnh browser.

## Mapping trong report

Report tải ảnh hiển thị riêng. Với Google Drive, report ưu tiên URL theo file ID:

```text
https://lh3.googleusercontent.com/d/{fileId}=w2400
```

Sau khi ảnh load, report có:

```text
naturalWidth
naturalHeight
```

Report map từ processing coordinate sang ảnh browser bằng:

```js
scaleX = naturalWidth / faceImageSize.width;
scaleY = naturalHeight / faceImageSize.height;
```

Ví dụ `_DSC0629.JPG`:

```text
faceImageSize: 1067 x 1600
naturalSize:   2400 x 3600
scaleX:        2.2492970946579196
scaleY:        2.25
```

Box processing:

```text
left: 843
top: 752
width: 64
height: 85
```

Box trên Canvas:

```text
left: 1896.1574507966263
top: 1692
width: 143.95501405810685
height: 191.25
```

## Canvas overlay

Report tạo Canvas overlay với:

```js
canvas.width = image.naturalWidth;
canvas.height = image.naturalHeight;
```

Do đó Canvas coordinate system nội tại giống ảnh browser:

```text
Canvas coordinate: 2400 x 3600
Image natural:     2400 x 3600
```

CSS làm Canvas hiển thị cùng kích thước với ảnh. Parent có `position: relative`, overlay có `position: absolute`.

Một lỗi layout đã được xác minh trước đây: nếu overlay có `margin-top: 12px` trong khi ảnh cũng có margin, Canvas bị đặt thấp hơn ảnh 12px. Khi đó dữ liệu và coordinate transform vẫn đúng, nhưng rectangle trên màn hình bị lệch dọc. Overlay không nên có margin riêng; margin chỉ nên thuộc layout của ảnh/wrapper.

## Phân biệt ba mức kiểm tra

### Data correctness

Kiểm tra:

```text
face-label output
				=
report input
```

Bao gồm `faceImageSize`, bbox và landmarks.

### Coordinate transform correctness

Kiểm tra:

```text
processing bbox/landmarks
				-> scaleX/scaleY
				-> Canvas coordinate
```

Không có bước EXIF compensation trong report. Report chỉ scale theo kích thước ảnh đã load.

### Rendering correctness

Kiểm tra:

```text
Canvas internal coordinate
				-> CSS size
				-> CSS position
				-> screen coordinate
```

Nếu Canvas và ảnh có cùng width/height nhưng khác `top` hoặc `left`, box vẫn đúng trong Canvas nhưng nhìn lệch trên màn hình.

## Lệnh chạy

Chạy labeling:

```powershell
node face-label-poc.js `
	--input image-links.js `
	--output image-links-labeled.js `
	--clusterOutput report/image-links-clusters.js `
	--report report/face-clusters-report.html `
	--concurrency 3 `
	--threshold 0.45 `
	--timeout 30000 `
	--maxDimension 1600
```

Kiểm tra cú pháp:

```powershell
node --check face-label-poc.js
node --check report/face-clusters-report.js
```

## Lưu ý về benchmark log

Trong phần benchmark cuối file, biểu thức hiện tại dùng:

```js
imageFaces.filter((items) => items.length)
```

Trong khi mỗi phần tử của `imageFaces` là object kết quả có dạng `{ width, height, faces }`. Vì vậy log `Images with faces` có thể không phản ánh đúng số ảnh có face, dù dữ liệu `faces` và output vẫn được tạo. Đây là vấn đề thống kê log, không làm thay đổi detection, embedding, clustering hoặc dữ liệu face đã lưu.
