# Thư viện ảnh và gắn nhãn khuôn mặt

Yêu cầu **Node.js 18 trở lên**. Project gồm hai quy trình:

* Trích xuất các liên kết ảnh công khai từ Google Drive hoặc OneDrive.
* Phát hiện và gom nhóm khuôn mặt chạy **local** bằng YuNet và SFace.

## Cài đặt

```powershell
npm install

npx playwright install chromium

npm run download-face-models
```

Các model nhận diện khuôn mặt được lưu trong thư mục `models/` và quá trình suy luận (inference) chạy **local trên CPU**. Pipeline gắn nhãn khuôn mặt **không upload ảnh lên server**.

## Trích xuất link ảnh

### Google Drive

Folder và các file ảnh phải được chia sẻ ở chế độ **Anyone with the link**.

Bật Google Drive API, tạo một API key bị giới hạn quyền (restricted API key), và chỉ thiết lập key đó trong phiên PowerShell local:

```powershell
$env:GOOGLE_DRIVE_API_KEY = 'YOUR_API_KEY'

node extract-drive-images.js "https://drive.google.com/drive/folders/FOLDER_ID" image-links.js
```

Output mặc định là `image-links.js`.

File này chứa:

```javascript
const seriesData = [...]
```

Trong đó có:

* tên file;
* file ID;
* URL ảnh trực tiếp.

### OneDrive

Folder phải được để ở chế độ **public**:

```powershell
npm run extract:onedrive -- "https://1drv.ms/f/..." image-onedrive-links.js
```

Extractor sử dụng Chromium để đọc các item ảnh sau khi trang được render, loại bỏ các ID bị trùng và ghi dữ liệu vào `seriesData`.

## Gallery tĩnh

Frontend nằm trong:

```text
FE/public/
```

Frontend sẽ load một file JavaScript chứa `seriesData`.

Muốn thay đổi dataset, hãy cập nhật file data được tham chiếu trong:

```text
FE/public/index.html
```

Website có thể được deploy dưới dạng **static files**.

Cấu hình và script để deploy Firebase nằm trong thư mục:

```text
FE/
```

Đối với chế độ sử dụng Google Drive API, hãy cấu hình **public API key** và **folder ID** trong cấu hình frontend.

**Tuyệt đối không đặt service-account key hoặc OAuth secret trong các file frontend.**

## Gắn nhãn khuôn mặt

CLI đọc file:

```text
image-onedrive-links.js
```

Sau đó tải từng ảnh gốc từ `imageUrl`. Nếu HTTP trả về **403**, chương trình mới fallback sang `thumbnailUrl` ở kích thước 2400 pixel.

Sau đó pipeline thực hiện:

1. Resize ảnh sao cho cạnh dài nhất tối đa **1600 pixel**.
2. Letterbox ảnh thành input **640×640** của YuNet.
3. Detect khuôn mặt và giải mã **5 landmarks**.
4. Căn chỉnh (align) từng khuôn mặt thành **112×112**, sau đó tạo **SFace embedding**.
5. Gom nhóm các embedding bằng **DBSCAN sử dụng cosine distance**.

### Chạy toàn bộ pipeline

```powershell
npm run face-label -- --concurrency 2 --threshold 0.45
```

Output mặc định:

* `image-onedrive-links-labeled.js`: dữ liệu gốc cộng thêm nhãn `persons`.
* `face-clusters-report.html`: báo cáo các khuôn mặt được gom nhóm, bao gồm face crop, confidence, bounding box và landmarks.

### Các tùy chọn hữu ích

```powershell
node face-label-poc.js --input image-onedrive-links.js --output image-onedrive-links-labeled.js --report face-clusters-report.html --concurrency 3 --threshold 0.45 --timeout 30000 --maxDimension 1600 --limit 200
```

## Cấu hình detector hiện tại

Các giá trị mặc định:

```text
minConfidence = 0.75
nmsThreshold = 0.5
minFaceSize = 20
maxFaceAspectRatio = 2.5
```

Có thể dùng:

```powershell
--name FILE.JPG --debug 1
```

để chỉ xử lý **một ảnh cụ thể** và in ra tọa độ detector sau khi decode.

## Kiểm tra kết quả

Nên **kiểm tra report bằng mắt**, vì độ chính xác phụ thuộc vào:

* kích thước khuôn mặt;
* góc nghiêng khuôn mặt;
* độ nhòe;
* ánh sáng;
* chất lượng ảnh.

Các embedding đơn lẻ sẽ được xem là **noise và không được gán vào nhóm**, bởi vì thuật toán clustering yêu cầu phải có **ít nhất hai khuôn mặt lân cận** mới tạo thành một cluster.
