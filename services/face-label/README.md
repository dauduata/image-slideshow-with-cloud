# Face Label Service

Thư mục này chứa pipeline Node.js để phát hiện khuôn mặt trong ảnh, tạo vector đặc trưng cho từng khuôn mặt, gom các khuôn mặt giống nhau thành nhóm và gắn nhãn tạm thời như `person-001`, `person-002`.

Đây là **nhận diện và gom nhóm khuôn mặt**, không phải nhận diện danh tính thật của một người. Hệ thống không biết người đó tên gì.

## Pipeline tổng quát

```text
file seriesData
    |
    v
đọc danh sách ảnh
    |
    v
tải ảnh từ URL
    |
    v
phát hiện 0..N khuôn mặt trong từng ảnh
    |
    v
căn chỉnh từng khuôn mặt về 112x112
    |
    v
tạo embedding bằng SFace
    |
    v
gom các embedding giống nhau
    |
    v
gán person-001, person-002, ...
    |
    v
ghi dữ liệu và báo cáo HTML
```

Một ảnh có thể có nhiều người. Ví dụ:

```js
{
  name: "group-photo.jpg",
  persons: ["person-001", "person-004"]
}
```

Ảnh không có khuôn mặt sẽ có `persons: []`. Khuôn mặt không đủ giống với nhóm nào sẽ được xem là `noise` trong báo cáo và không xuất hiện trong `persons`.

## Yêu cầu môi trường

- Node.js 18 trở lên.
- Các package trong `package.json` đã được cài bằng `npm install`.
- Hai model ONNX trong thư mục gốc `models/`:
  - `face_detection_yunet_2023mar.onnx`: phát hiện khuôn mặt và 5 điểm landmark.
  - `face_recognition_sface_2021dec.onnx`: tạo embedding khuôn mặt.

Cài đặt từ thư mục gốc của project:

```bash
npm install
npm run download-face-models
```

Pipeline này không dùng Playwright và không quét OneDrive. Nó chỉ đọc metadata đã có sẵn trong file input rồi tải ảnh qua các URL trong từng record.

## Dữ liệu đầu vào

File input phải khai báo một biến tên là `seriesData` và biến này phải là một mảng:

```js
const seriesData = [
  {
    name: "IMG_001.jpg",
    id: "image-id-001",
    url: "https://example.com/original-image.jpg",
    thumbnailUrl: "https://example.com/thumbnail.jpg"
  }
];
```

Các field được sử dụng:

| Field | Ý nghĩa |
| --- | --- |
| `name` | Tên ảnh, dùng trong log và báo cáo. |
| `id` | ID gốc của ảnh, được giữ nguyên trong output. |
| `url` | URL ưu tiên để tải ảnh gốc. |
| `thumbnailUrl` | URL dự phòng khi `url` trả HTTP 403. |

File được đọc bằng cách thực thi trong một sandbox JavaScript. Vì vậy chỉ nên dùng file dữ liệu đáng tin cậy, không đặt logic tùy ý vào file input.

## Chạy cơ bản

Từ thư mục gốc project:

```bash
npm run face-label
```

Lệnh tương đương:

```bash
node services/face-label/runner.js
```

Mặc định chương trình dùng:

| Mục | Giá trị mặc định |
| --- | --- |
| Input | `image-links.js` |
| Output có nhãn | `image-links-labeled.js` |
| Output chi tiết cluster | `report/image-links-clusters.js` |
| Báo cáo HTML | `face-clusters-report/index.html` |
| Face detector | `models/face_detection_yunet_2023mar.onnx` |
| Face recognizer | `models/face_recognition_sface_2021dec.onnx` |
| Ngưỡng gom nhóm | `0.45` |
| Số worker tải ảnh | `1` |
| Timeout mỗi lần tải | `120000` ms |

Ví dụ dùng file OneDrive:

```bash
npm run face-label -- \
  --input image-onedrive-links.js \
  --output image-onedrive-links-labeled.js \
  --cluster-output report/image-onedrive-links-clusters.js \
  --report face-clusters-report/onedrive.html
```

Trên Windows PowerShell, có thể viết cùng lệnh trên một dòng hoặc dùng dấu backtick `` ` `` để xuống dòng.

## Các tùy chọn dòng lệnh

```text
--input FILE
--output FILE
--cluster-output FILE
--report FILE
--detector FILE
--recognizer FILE
--name IMAGE_NAME
--names NAME_1,NAME_2
--limit NUMBER
--concurrency NUMBER
--threshold NUMBER
--timeout MILLISECONDS
--minConfidence NUMBER
--nmsThreshold NUMBER
--minFaceSize NUMBER
--maxFaceAspectRatio NUMBER
--maxDimension NUMBER
--debug VALUE
--clusterPair FACE_INDEX_1,FACE_INDEX_2
```

Ví dụ:

```bash
node services/face-label/runner.js \
  --input image-links.js \
  --output image-links-labeled.js \
  --concurrency 2 \
  --threshold 0.45 \
  --timeout 30000 \
  --limit 100
```

### Lọc ảnh cần xử lý

Xử lý một ảnh theo đúng `name`:

```bash
node services/face-label/runner.js --name IMG_001.jpg
```

Xử lý nhiều ảnh:

```bash
node services/face-label/runner.js --names IMG_001.jpg,IMG_002.jpg
```

Giới hạn số record đầu tiên:

```bash
node services/face-label/runner.js --limit 50
```

`--name` và `--names` lọc theo field `name`, không phải theo `id`. Nếu tên không tồn tại, chương trình dừng với lỗi.

### Điều chỉnh chất lượng và tốc độ

- `--concurrency`: số ảnh xử lý đồng thời. Tăng giá trị giúp nhanh hơn nhưng dùng nhiều CPU, RAM và băng thông hơn.
- `--timeout`: thời gian chờ tải ảnh, tính bằng milliseconds.
- `--maxDimension`: resize ảnh sao cho cạnh dài nhất không vượt quá giá trị này.
- `--minConfidence`: ngưỡng tin cậy khi YuNet phát hiện khuôn mặt.
- `--nmsThreshold`: ngưỡng loại bỏ các vùng phát hiện trùng nhau.
- `--minFaceSize`: bỏ qua khuôn mặt quá nhỏ.
- `--maxFaceAspectRatio`: bỏ qua bounding box có tỷ lệ quá bất thường.
- `--threshold`: khoảng cách cosine tối đa để hai nhóm được gộp. Giá trị nhỏ hơn thường nghiêm ngặt hơn; giá trị lớn hơn dễ gộp nhầm hơn.

Nên bắt đầu với giá trị mặc định, sau đó kiểm tra báo cáo trực quan trước khi thay đổi `--threshold`.

## Cấu trúc thư mục và vai trò từng file

### `runner.js`

File điều phối chính và là entry point của service.

Nó thực hiện các bước:

1. Đọc tham số dòng lệnh.
2. Chọn các record cần xử lý.
3. Nạp hai model ONNX.
4. Tải và xử lý ảnh.
5. Gom tất cả khuôn mặt từ các ảnh.
6. Gọi thuật toán clustering.
7. Đổi ID cluster thành `person-001`, `person-002`, ...
8. Ghi các output và báo cáo.
9. In thống kê thời gian, số ảnh, số khuôn mặt và số ảnh lỗi.

### `config.js`

Chứa:

- đường dẫn gốc của project;
- giá trị mặc định của các tùy chọn;
- parser cho tham số CLI;
- hàm đọc `seriesData` từ file JavaScript.

Có thể cấu hình bằng biến môi trường. Tên biến tương ứng với các tùy chọn chính:

```text
FACE_LABEL_INPUT
FACE_LABEL_OUTPUT
FACE_LABEL_CLUSTER_OUTPUT
FACE_LABEL_REPORT
FACE_LABEL_DETECTOR
FACE_LABEL_RECOGNIZER
FACE_LABEL_CONCURRENCY
FACE_LABEL_THRESHOLD
FACE_LABEL_TIMEOUT
FACE_LABEL_MIN_CONFIDENCE
FACE_LABEL_NMS_THRESHOLD
FACE_LABEL_MIN_FACE_SIZE
FACE_LABEL_MAX_FACE_ASPECT_RATIO
FACE_LABEL_MAX_DIMENSION
```

Tham số dòng lệnh được truyền trực tiếp sẽ ghi đè giá trị mặc định và giá trị môi trường.

### `fetcher.js`

Chịu trách nhiệm tải ảnh:

1. Thử tải từ `record.url` bằng `fetch`.
2. Nếu lỗi HTTP 403, thử `record.thumbnailUrl`.
3. Khi dùng thumbnail fallback, thay `width` và `height` trong query string thành `2400` nếu các tham số này tồn tại.
4. Nếu `fetch` không tải được, thử lại bằng lệnh `curl`.
5. Hủy request khi quá timeout.

Nếu URL chính không phải HTTP 403 mà lỗi vì lý do khác, pipeline không tự chuyển sang thumbnail.

### `vision.js`

Chứa phần computer vision:

- resize và xoay ảnh theo metadata;
- đưa ảnh vào YuNet ở kích thước 640x640;
- giải mã confidence, bounding box và 5 landmarks;
- loại bỏ detection trùng bằng NMS;
- bỏ qua khuôn mặt quá nhỏ hoặc bounding box bất thường;
- căn chỉnh khuôn mặt về 112x112;
- chạy SFace để tạo embedding;
- tạo preview trước và sau căn chỉnh;
- tạo ảnh annotated có bounding box và landmarks.

Mỗi khuôn mặt sau khi xử lý có các dữ liệu nội bộ như `embedding`, `box`, `landmarks`, `confidence`, preview và kích thước ảnh. Embedding chỉ tồn tại trong RAM và không được ghi vào output JavaScript.

### `clustering.js`

Chứa:

- `cosineDistance`: tính khoảng cách cosine giữa hai embedding;
- `cluster`: gom nhóm embedding theo khoảng cách cosine.

Thuật toán hiện tại là **agglomerative hierarchical clustering với complete-link distance**, không phải DBSCAN.

Các quy tắc chính:

- Cluster bắt đầu với từng khuôn mặt riêng lẻ.
- Mỗi lần chọn hai cluster có complete-link distance nhỏ nhất.
- Chỉ gộp khi khoảng cách không vượt quá `threshold`.
- Không cho phép gộp hai cluster nếu chúng chứa hai khuôn mặt từ cùng một ảnh.
- Cluster được sắp xếp lại theo face index đầu tiên và sau đó đổi thành tên `person-XXX` ở `runner.js`.

Vì vậy kết quả là nhóm khuôn mặt tương đồng, không phải khẳng định danh tính tuyệt đối.

### `report.js`

Chuyển dữ liệu khuôn mặt thành dữ liệu dùng cho báo cáo và sinh một file HTML độc lập.

Báo cáo hiển thị:

- từng cluster hoặc nhóm `noise / unassigned`;
- ảnh gốc có bounding box;
- crop trước căn chỉnh;
- crop sau căn chỉnh 112x112;
- confidence;
- tọa độ bounding box;
- tọa độ 5 landmarks.

Ảnh preview được nhúng trực tiếp dưới dạng data URI nên file HTML có thể mở trực tiếp trong trình duyệt, không cần server riêng.

## Các file output

### File labeled output

Ví dụ `image-links-labeled.js` giữ nguyên các field gốc và bổ sung:

```js
const seriesData = [
  {
    name: "IMG_001.jpg",
    id: "image-id-001",
    url: "https://example.com/original-image.jpg",
    thumbnailUrl: "https://example.com/thumbnail.jpg",
    faces: [
      {
        faceIndex: 0,
        imageFaceIndex: 0,
        imageIndex: 0,
        box: { left: 100, top: 80, width: 120, height: 140 },
        confidence: 0.91
      }
    ],
    persons: ["person-001"]
  }
];
```

`faces` chứa thông tin vị trí khuôn mặt phục vụ frontend hoặc kiểm tra. `persons` là danh sách nhãn của các khuôn mặt thuộc cluster hợp lệ trong ảnh.

### File cluster output

Ví dụ `report/image-links-clusters.js` chứa thêm thông tin dùng cho việc kiểm tra cluster:

```js
{
  name: "group-photo.jpg",
  faceImageSize: { width: 1600, height: 1200 },
  faces: [...],
  persons: [
    {
      id: "person-001",
      confidence: 0.94,
      box: { left: 100, top: 80, width: 120, height: 140 },
      landmarks: [{ x: 120, y: 110 }]
    }
  ]
}
```

### Báo cáo HTML

Mở file báo cáo bằng trình duyệt:

```text
face-clusters-report/index.html
```

Hãy dùng báo cáo để kiểm tra bằng mắt xem các khuôn mặt trong cùng một `person-XXX` có thực sự là cùng người hay không.

## Cách đọc log

Một số log thường gặp:

```text
[1/100] IMG_001.jpg faces: 2 source: url
```

Ảnh đã xử lý thành công và phát hiện 2 khuôn mặt.

```text
[2/100] IMG_002.jpg faces: 0 source: thumbnailUrl@2400 (fallback after HTTP 403)
```

URL gốc trả 403, chương trình đã dùng thumbnail fallback.

```text
[CLUSTER] MERGE #1 complete=0.2314 threshold=0.45 ...
```

Hai cluster được gộp vì khoảng cách không vượt ngưỡng.

```text
SKIPPED
```

Ảnh bị bỏ qua do lỗi tải hoặc lỗi xử lý. Cuối chương trình, mục `Failed images` cho biết tổng số ảnh lỗi.

## Debug trường hợp nghi ngờ

Bật debug khi cần kiểm tra detector, landmarks, alignment và khoảng cách embedding:

```bash
node services/face-label/runner.js \
  --name IMG_001.jpg \
  --debug 1
```

Theo dõi một cặp face index cụ thể:

```bash
node services/face-label/runner.js \
  --input image-links.js \
  --clusterPair 6,10 \
  --debug 1
```

`clusterPair` dùng **face index trong mảng faces sau khi flatten**, không phải số thứ tự ảnh và cũng không phải `imageIndex`.

## Xử lý lỗi thường gặp

### `Models missing`

Chạy:

```bash
npm run download-face-models
```

Hoặc kiểm tra lại `--detector` và `--recognizer`.

### `Input does not define an array named seriesData`

File input phải chứa đúng dạng:

```js
const seriesData = [...];
```

Tên biến khác như `images` hoặc `data` sẽ không được nhận.

### `thumbnailUrl is missing`

URL chính đã trả HTTP 403 nhưng record không có `thumbnailUrl`. Bổ sung field này hoặc sửa nguồn dữ liệu.

### `All selected image(s) failed`

Tất cả ảnh được chọn đều tải hoặc xử lý thất bại. Kiểm tra các dòng `ERROR`, URL, timeout, quyền truy cập và kết nối mạng.

### Quá nhiều hoặc quá ít người trong một nhóm

Kiểm tra báo cáo HTML trước. Sau đó thử điều chỉnh `--threshold`:

```bash
node services/face-label/runner.js --threshold 0.40
```

Ngưỡng chỉ là tham số thực nghiệm. Ảnh mờ, mặt nghiêng, mặt quá nhỏ hoặc ánh sáng khác nhau có thể làm embedding kém ổn định.

## Lưu ý về độ tin cậy

- Nhãn `person-001` chỉ có ý nghĩa trong một lần chạy và dataset đó; không phải ID vĩnh viễn của người.
- Chạy lại pipeline có thể tạo thứ tự nhãn khác nếu input hoặc kết quả detection thay đổi.
- Hai người khác nhau có thể bị gom nhầm khi ảnh chất lượng thấp.
- Cùng một người có thể bị tách thành nhiều nhóm khi khuôn mặt quá nhỏ, bị che, nghiêng mạnh hoặc ánh sáng thay đổi.
- Nên xem báo cáo trực quan trước khi dùng output cho dữ liệu chính thức.
- Embedding không được lưu lại, nên muốn thay đổi thuật toán hoặc ngưỡng phải chạy lại pipeline.
