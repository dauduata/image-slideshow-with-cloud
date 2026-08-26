Hãy triển khai bước tiếp theo của POC theo đúng phạm vi sau:

Mục tiêu:

* Giữ nguyên YuNet detector hiện tại.
* Giữ nguyên SFace model hiện tại.
* Giữ nguyên DBSCAN/clustering hiện tại.
* Chỉ bổ sung việc decode 5 facial landmarks từ output `kps_*` của YuNet và align face trước khi đưa vào SFace.

Yêu cầu:

1. Kiểm tra code hiện tại để xác định chính xác format output `kps_8`, `kps_16`, `kps_32` của model YuNet đang sử dụng.

   * Không đoán thứ tự landmark.
   * Không tự giả định layout tensor.
   * Đối chiếu với model/code chính thức nếu cần.

2. Decode đúng 5 landmarks cho mỗi detection:

   * right eye
   * left eye
   * nose tip
   * right mouth corner
   * left mouth corner

3. Chuyển tọa độ landmark từ output của YuNet về đúng hệ tọa độ pixel của ảnh source.

4. Implement face alignment:

   * dùng 5 landmarks của YuNet;
   * dùng similarity transform / affine transform phù hợp;
   * output chính xác `112x112`;
   * giữ nguyên aspect ratio khuôn mặt;
   * không crop bằng bounding box đơn thuần nữa.

5. Đưa face đã align `112x112` vào SFace để tạo embedding.

6. Không thay đổi thuật toán clustering hiện tại.

   * Không thay đổi DBSCAN.
   * Không thay đổi threshold mặc định.
   * Không thay đổi logic grouping.
   * Mục đích bước này chỉ để cải thiện chất lượng embedding đầu vào.

7. Chỉ chạy test riêng:
   `_DSC0556.JPG`

8. Debug output phải cho biết:

   * số face detect được;
   * bounding box từng face;
   * 5 landmark coordinates từng face;
   * kích thước face crop trước alignment;
   * xác nhận aligned face là `112x112`;
   * embedding distance giữa các face nếu test có nhiều face;
   * kết quả clustering hiện tại.

9. Tạo hoặc cập nhật debug report để có thể nhìn trực quan:

   * ảnh gốc;
   * bounding box;
   * 5 landmark points;
   * face crop trước alignment;
   * face sau alignment 112x112.

10. Không chạy toàn bộ 3,000 ảnh ở bước này.

11. Không download hoặc thay model khác.
    Chỉ sử dụng đúng YuNet và SFace model hiện tại của POC.

12. Sau khi implementation xong, hãy báo cáo:

    * những file nào đã thay đổi;
    * thay đổi ở function nào;
    * format output `kps_*` thực tế của model;
    * cách chuyển landmark coordinates về source-image coordinates;
    * cách tính similarity transform;
    * kết quả test `_DSC0556.JPG`.

Nếu có bất kỳ điểm nào chưa chắc chắn về format `kps_*`, hãy dừng ở đó và kiểm tra model implementation/documentation trước, không được tự suy đoán.
