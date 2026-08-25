Bạn là senior Node.js / Computer Vision engineer.

Tôi cần bạn xây dựng **MỘT POC Node.js nhỏ, chạy local**, để kiểm tra khả năng tự động phát hiện và gom nhóm người trong khoảng 100–200 ảnh trước khi triển khai cho dataset khoảng 3.000 ảnh.

## 1. BỐI CẢNH HIỆN TẠI

Tôi đã có sẵn file:

`image-onedrive-links.js`

File này được tạo bởi một chương trình Playwright khác. Playwright đã quét một OneDrive Public Folder và tạo ra:

```js
const seriesData = [
  {
    "name": "IMG_20260821_054425.jpg",
    "id": "C3EEA47A85D86883!sb885c70fb864407abc18cc7128658907",
    "url": "https://onedrive.live.com/download?resid=...",
    "thumbnailUrl": "https://..."
  },
  ...
];
```

Mỗi record có tối thiểu:

* `name`
* `id`
* `url`
* `thumbnailUrl`

Trong đó:

* `url` là URL để tải ảnh gốc từ OneDrive.
* `thumbnailUrl` chỉ là thumbnail nhỏ của OneDrive.
* Ảnh gốc thực tế có kích thước khoảng 2400x2400.

## 2. QUAN TRỌNG: KHÔNG ĐƯỢC DÙNG PLAYWRIGHT

POC này hoàn toàn độc lập với chương trình Playwright hiện tại.

KHÔNG:

* mở OneDrive bằng browser
* scan folder
* scroll OneDrive
* tìm `ItemTile`
* dùng Playwright
* xây lại logic lấy danh sách ảnh

POC chỉ cần:

```text
image-onedrive-links.js
        ↓
đọc seriesData
        ↓
xử lý ảnh thông qua image.url
```

Playwright đã làm xong phần thu thập metadata.

## 3. MỤC TIÊU CỦA POC

POC phải thực hiện pipeline:

```text
seriesData
    ↓
download/process từng image.url
    ↓
face detection
    ↓
face embedding
    ↓
gom nhóm các khuôn mặt giống nhau
    ↓
person-001
person-002
person-003
...
    ↓
gắn group vào từng image
    ↓
ghi output JS mới
```

Tôi KHÔNG cần AI biết tên thật của người.

Tôi chỉ cần:

```text
person-001
person-002
person-003
...
```

Sau này tôi có thể tự label những group này nếu muốn.

## 4. ẢNH CÓ THỂ CÓ NHIỀU NGƯỜI

Đây là yêu cầu bắt buộc.

Ví dụ:

```text
image-001.jpg
    face A
    face B
    face C
```

Nếu:

```text
face A → person-001
face B → person-007
face C → person-003
```

thì record phải có:

```js
"persons": [
  "person-001",
  "person-007",
  "person-003"
]
```

KHÔNG được ép mỗi image chỉ có một person.

Một ảnh cũng có thể không có người:

```js
"persons": []
```

## 5. KHÔNG CLUSTER THEO IMAGE

Phải cluster theo từng KHUÔN MẶT.

Pipeline đúng là:

```text
image
  ↓
detect 0..N faces
  ↓
mỗi face → embedding
  ↓
cluster embeddings
  ↓
cluster = person group
  ↓
map group ngược về image
```

Ví dụ:

```text
IMG_001
    face A → person-001
    face B → person-003

IMG_002
    face C → person-001

IMG_003
    face D → person-003
    face E → person-005
```

Output:

```js
IMG_001.persons = ["person-001", "person-003"]
IMG_002.persons = ["person-001"]
IMG_003.persons = ["person-003", "person-005"]
```

## 6. KHÔNG CẦN DATABASE

Tôi KHÔNG muốn:

* MongoDB
* SQLite
* PostgreSQL
* Redis
* vector database
* cloud database

Embedding chỉ cần tồn tại trong memory trong thời gian POC chạy.

Không cần lưu embedding vào output.

Output cuối chỉ cần thêm:

```js
"persons": ["person-001", "person-003"]
```

## 7. KHÔNG ĐƯỢC PHÁ DATA GỐC

POC phải đọc:

`image-onedrive-links.js`

và tạo file mới, ví dụ:

`image-onedrive-links-labeled.js`

KHÔNG overwrite file gốc trong POC.

Các field hiện tại phải được giữ nguyên:

```js
{
  name,
  id,
  url,
  thumbnailUrl
}
```

Chỉ bổ sung:

```js
persons
```

Ví dụ:

```js
{
  "name": "IMG_20260821_054425.jpg",
  "id": "...",
  "url": "...",
  "thumbnailUrl": "...",
  "persons": [
    "person-001",
    "person-004"
  ]
}
```

## 8. KHÔNG TẢI TOÀN BỘ ẢNH VÀO RAM

Dataset cuối cùng có khoảng 3.000 ảnh, kích thước khoảng 2400x2400.

POC phải được thiết kế để không làm:

```text
download 3000 images
        ↓
keep all images in RAM
```

Mà phải xử lý từng ảnh hoặc theo queue/concurrency giới hạn:

```text
image
 ↓
download
 ↓
process
 ↓
extract face embeddings
 ↓
release image memory
 ↓
next image
```

Có thể dùng concurrency nhỏ, ví dụ 2–4 worker, nhưng phải thiết kế thành cấu hình có thể điều chỉnh.

Ví dụ:

```bash
node face-label-poc.js --concurrency 3
```

Không được mặc định tạo hàng chục request song song.

## 9. ẢNH 2400x2400

Không nhất thiết phải đưa nguyên ảnh 2400x2400 vào model.

Nếu model có kích thước input nhỏ hơn, hãy resize ảnh phù hợp trước khi inference.

Nhưng phải giữ đủ thông tin để nhận diện khuôn mặt nhỏ trong ảnh nhiều người.

Hãy giải thích rõ model yêu cầu kích thước input nào và tại sao chọn resize như vậy.

## 10. LIBRARY / MODEL

Đây là phần rất quan trọng.

Tôi muốn chạy AI **LOCAL**, không upload ảnh lên cloud AI service.

Ưu tiên:

* Node.js
* chạy CPU local
* cross-platform
* Windows
* macOS
* không yêu cầu GPU
* không yêu cầu CUDA
* cài đặt đơn giản
* hiệu năng hợp lý

Tôi đặc biệt muốn tránh việc POC phụ thuộc nặng vào TensorFlow.js nếu không thực sự cần.

Hãy ưu tiên xem xét:

* ONNX Runtime cho Node.js
* các face detection model phù hợp
* các face embedding model phù hợp
* ArcFace hoặc model embedding tương đương nếu phù hợp
* clustering algorithm phù hợp cho face embeddings

Có thể sử dụng package/model khác nếu bạn có lý do kỹ thuật tốt hơn.

### Nhưng:

ĐỪNG chỉ chọn library theo tên.

Hãy giải thích:

1. Face detector nào?
2. Face embedding model nào?
3. Clustering algorithm nào?
4. Vì sao chọn chúng?
5. Có chạy CPU trên Windows và macOS không?
6. Dependencies nặng đến mức nào?
7. Có model nào phải download riêng không?
8. Model license có vấn đề gì không?
9. Accuracy dự kiến thế nào?
10. Performance dự kiến thế nào?

Nếu có nhiều lựa chọn, hãy chọn **một stack mặc định để POC chạy được**, không biến POC thành một project nghiên cứu với quá nhiều option.

## 11. CLUSTERING

Tôi không biết trước có bao nhiêu người trong dataset.

Vì vậy KHÔNG được yêu cầu tôi nhập:

```text
number of persons = 20
```

Algorithm phải tự xác định số group.

Hãy chọn clustering algorithm phù hợp cho face embeddings, ví dụ xem xét:

* DBSCAN
* HDBSCAN
* hoặc phương pháp phù hợp khác.

Phải xử lý được trường hợp:

```text
một số khuôn mặt không đủ giống bất kỳ group nào
```

Không được ép tất cả khuôn mặt vào một group.

Hãy giải thích threshold / distance metric đang dùng và cho phép điều chỉnh bằng CLI option nếu cần.

Ví dụ:

```bash
node face-label-poc.js --threshold 0.45
```

## 12. POC CHỈ CẦN CLI

KHÔNG cần:

* web UI
* React
* Electron
* Express server
* database UI
* login
* authentication
* deployment
* Docker

Chỉ cần command line.

Ví dụ:

```bash
node face-label-poc.js
```

## 13. PROGRESS

Vì có 100–200 ảnh thử nghiệm và sau này khoảng 3.000 ảnh, cần có progress rõ ràng.

Ví dụ:

```text
[1/150] IMG_001.jpg     faces: 2
[2/150] IMG_002.jpg     faces: 0
[3/150] IMG_003.jpg     faces: 1
...
[150/150] IMG_150.jpg   faces: 3

Face detection complete.

Total images: 150
Images with faces: 103
Images without faces: 47
Total faces: 187

Clustering...

Person groups:
person-001: 31 faces
person-002: 24 faces
person-003: 19 faces
...
```

## 14. BENCHMARK

POC phải có benchmark.

Tôi muốn chạy cùng một dataset trên:

### Windows

Ghi:

* OS
* CPU
* RAM
* Node.js version
* model
* number of images
* number of faces
* total processing time
* average processing time/image
* peak hoặc estimated memory usage nếu có thể đo
* clustering time

### macOS

Ghi cùng các thông số.

Không cần benchmark GPU.

Mục tiêu trước mắt là **CPU local**.

Hãy tạo một summary cuối chương trình:

```text
===== BENCHMARK =====

Platform: Windows
CPU: ...
RAM: ...
Node.js: ...

Images: 150
Faces: 187
Groups: 12

Detection + embedding: 123.4 sec
Clustering: 0.8 sec
Total: 124.2 sec

Average: 828 ms/image
=====================
```

## 15. ERROR HANDLING

OneDrive public URL có thể có ảnh lỗi hoặc request timeout.

Nếu một ảnh không tải được:

KHÔNG được làm crash toàn bộ chương trình.

Ví dụ:

```text
[37/150] IMG_037.jpg
ERROR: download failed
SKIPPED
```

và cuối cùng:

```text
Failed images: 2
```

Các ảnh khác vẫn tiếp tục xử lý.

Cũng cần timeout cho HTTP request.

## 16. NETWORK / IMAGE DOWNLOAD

Sử dụng `url` trong data.

Không dùng `thumbnailUrl` cho face recognition nếu thumbnail quá nhỏ.

Không cần lưu ảnh xuống disk nếu có thể xử lý trực tiếp trong memory.

Nếu library/model yêu cầu file thì có thể dùng temporary file, nhưng ưu tiên memory stream/buffer.

Sau mỗi image phải giải phóng buffer/reference không cần thiết.

## 17. OUTPUT

POC tạo:

`image-onedrive-links-labeled.js`

với:

```js
const seriesData = [
  {
    "name": "...",
    "id": "...",
    "url": "...",
    "thumbnailUrl": "...",
    "persons": [
      "person-001",
      "person-003"
    ]
  }
];
```

Thứ tự các record phải được giữ nguyên như input.

Không được thay đổi:

* name
* id
* url
* thumbnailUrl

## 18. KIỂM TRA KẾT QUẢ

Tôi muốn có cách kiểm tra clustering bằng mắt.

POC có thể tạo thêm một report đơn giản, ví dụ:

`face-clusters-report.html`

Report không cần UI phức tạp.

Chỉ cần hiển thị các group:

```text
Person 001
[thumbnail] [thumbnail] [thumbnail] ...

Person 002
[thumbnail] [thumbnail] [thumbnail] ...

Person 003
[thumbnail] [thumbnail] ...
```

Mục đích là tôi có thể nhìn nhanh xem:

```text
person-001
```

có thực sự là cùng một người hay không.

Nếu tạo report HTML, ưu tiên dùng `thumbnailUrl` để hiển thị nhằm tránh tải ảnh gốc.

Không cần copy thumbnail về local.

## 19. KHÔNG LABEL TÊN NGƯỜI

Không cần:

```text
Nguyen Van A
John
Mary
```

Chỉ cần:

```text
person-001
person-002
person-003
```

Tôi sẽ tự label sau nếu muốn.

## 20. POC DATASET

Trước tiên tôi sẽ chạy khoảng:

**100–200 ảnh**

Không được thiết kế cứng chỉ cho 100–200 ảnh.

Code phải có khả năng sau này chạy:

```text
100
200
1000
3000+
```

mà không cần thay đổi architecture.

## 21. SAU KHI CLUSTERING

Không cần chạy Playwright lần nữa.

Không cần download lại danh sách OneDrive.

Không cần database.

Không cần embedding database.

Toàn bộ flow:

```text
read existing seriesData
        ↓
process image URLs
        ↓
detect faces
        ↓
generate embeddings
        ↓
cluster ALL embeddings
        ↓
map clusters back to images
        ↓
add persons[]
        ↓
write new JS file
```

## 22. QUAN TRỌNG: ĐỪNG XÂY QUÁ MỨC CẦN THIẾT

Đây là POC.

Tôi KHÔNG muốn bạn:

* xây full application
* xây UI phức tạp
* xây database
* tích hợp Playwright
* tích hợp OneDrive API
* tích hợp cloud AI
* xây authentication
* xây deployment system

Chỉ cần POC command-line để kiểm tra:

**"Local machine có thể detect + embed + cluster 100–200 ảnh đủ nhanh và đủ chính xác hay không?"**

## 23. CÁCH TRẢ LỜI

Trước khi viết code:

1. Nêu stack library/model bạn chọn.
2. Giải thích ngắn gọn vì sao.
3. Giải thích tại sao không cần TensorFlow.js nếu bạn chọn ONNX.
4. Nêu yêu cầu cài đặt trên Windows và macOS.
5. Nêu cách tải model.
6. Nêu cách chạy POC.
7. Sau đó mới đưa toàn bộ code cần thiết.

Nếu có dependency hoặc model nào có vấn đề về compatibility giữa Windows và macOS, phải nói rõ trước.

Ưu tiên giải pháp **đơn giản, local, CPU, cross-platform và dễ benchmark** hơn là giải pháp quá phức tạp.
