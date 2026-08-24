Hãy sửa POC hiện tại để thay cách fetch Google Drive folder bằng Google Drive API.

Yêu cầu:
1. Bỏ cách `fetch(folderUrl)` rồi parse HTML bằng `IMAGE_PATTERN`. Không được phụ thuộc vào HTML của trang Drive nữa.
2. Folder URL mẫu:
   https://drive.google.com/drive/folders/1VYWUy-aFfBkw6zvUfl0xo_3cDrM-Fp5Q
   Folder ID là `1VYWUy-aFfBkw6zvUfl0xo_3cDrM-Fp5Q`.
3. Dùng Google Drive API `files.list` để lấy các file trong folder:
   - query: `'FOLDER_ID' in parents and trashed = false`
   - chỉ lấy image (`mimeType` bắt đầu bằng `image/`)
4. Phải xử lý pagination bằng `nextPageToken` để lấy TẤT CẢ files, không được chỉ lấy 50 hoặc 100 items đầu tiên.
5. Có thể dùng `pageSize=1000`.
6. Giữ nguyên output hiện tại:
   {
     name,
     id,
     url: `https://drive.google.com/uc?export=view&id=${id}`
   }
7. Giữ nguyên format `seriesData` và cách ghi `image-links.js` hiện tại.
9. Nếu POC hiện tại chưa có cơ chế authentication cho Google Drive API, hãy bổ sung credential/token cần thiết và giải thích ngắn gọn cách cấu hình.
10. Sau khi sửa, cho tôi biết chính xác file nào và đoạn nào đã thay đổi, nhưng không viết lại những phần không cần sửa.

Mục tiêu: Google Drive folder có 500 ảnh thì phải lấy đủ cả 500 ảnh, không dừng ở 50.