Hãy refactor phần Face Cluster Report hiện tại của tôi theo đúng yêu cầu dưới đây.

## 1. MỤC TIÊU

Hiện tại report đang có:

* `face-clusters-report.html`
* `face-clusters-report.js`
* `image-links-clusters.js` được `main()` sinh ra

Nhưng `face-clusters-report.js` hiện đang dùng `document.querySelector('#report').innerHTML = ...` và dựng gần như toàn bộ HTML bằng string.

Tôi KHÔNG muốn kiến trúc này.

Hãy chuyển report thành kiến trúc rõ ràng:

```text
face-clusters-report.html
face-clusters-report.css
face-clusters-report.js
image-links-clusters.js    <-- generated data, không sửa thành code UI
```

Trong đó:

* HTML = cấu trúc trang tĩnh
* CSS = toàn bộ giao diện
* JS = render data + xử lý Canvas + behavior
* `image-links-clusters.js` = chỉ chứa data do `main()` sinh ra
* Không nhúng CSS vào JS
* Không dựng toàn bộ HTML bằng `innerHTML`
* Không dùng HTML template string để dựng report
* Không dùng `querySelector()` trong JS để tìm root element

Có thể dùng:

```js
document.getElementById(...)
document.createElement(...)
element.appendChild(...)
element.textContent = ...
```

Ưu tiên tạo DOM bằng `createElement()` và `appendChild()`.

---

# 2. HTML

Hãy tạo lại `face-clusters-report.html` thành một file HTML tĩnh, sạch.

HTML phải chứa sẵn skeleton của report, ví dụ:

```html
<main id="report">

    <div class="report-header">
        <h1>Face Clusters</h1>
        <p id="report-status">Loading...</p>
    </div>

    <div id="clusters"></div>

</main>
```

CSS phải được load bằng:

```html
<link rel="stylesheet" href="face-clusters-report.css">
```

JS phải được load theo thứ tự:

```html
<script src="image-links-clusters.js"></script>
<script src="face-clusters-report.js"></script>
```

Không đưa CSS vào `<style>` trong HTML nếu đã tách thành `face-clusters-report.css`.

---

# 3. CSS

Tạo file:

```text
face-clusters-report.css
```

Chuyển toàn bộ CSS hiện tại sang file này.

Giữ giao diện hiện tại gần như nguyên vẹn:

* background
* typography
* cluster section
* original image
* face grid
* face card
* face crop
* caption
* spacing

Không redesign giao diện nếu không cần thiết.

Các kích thước hiện tại như:

```text
232px face card
232px face crop
```

có thể giữ nguyên.

---

# 4. JS KHÔNG ĐƯỢC DỰNG HTML BẰNG STRING

Đây là yêu cầu quan trọng.

KHÔNG làm kiểu:

```js
document.querySelector('#report').innerHTML = ...
```

KHÔNG làm:

```js
'<section>' +
'<h2>' +
...
```

KHÔNG tạo cả report bằng một chuỗi HTML lớn.

KHÔNG dùng `escapeHtml()` chỉ để phục vụ việc dựng HTML string.

Thay vào đó:

```js
const section = document.createElement('section');
const heading = document.createElement('h2');

heading.textContent = personId;

section.appendChild(heading);
```

Tách thành các function nhỏ, ví dụ:

```text
buildGroups()
createCluster()
createOriginalImage()
createFaceCard()
renderFaceCrop()
renderReport()
```

Tên function có thể thay đổi nếu cần, nhưng trách nhiệm phải được tách rõ.

---

# 5. FACE CROP BẰNG CANVAS

Report phải hiển thị **ảnh crop của từng face** bằng Canvas.

Không được lưu ảnh face dưới dạng:

* base64
* data URL
* binary
* JPEG/PNG crop riêng
* `person.image`

trong `image-links-clusters.js`.

Tôi KHÔNG muốn data file bị phình lên vì phải lưu 90 face images.

Thay vào đó:

```text
image-links-clusters.js
        |
        | record.url
        v
original image
        |
        | person.box
        v
Canvas crop trong browser
```

Canvas được tạo lúc mở report.

---

# 6. COORDINATE CỦA FACE BOX

Hiện tại:

```js
person.box
```

đang chứa tọa độ trên ảnh đã resize để chạy detector.

Vì vậy Canvas không thể lấy trực tiếp `person.box` làm tọa độ pixel của ảnh gốc.

Cần lưu thêm kích thước ảnh processing.

Tại `detectAndEmbed()` hiện tại, khi `faces.push()` hãy bổ sung:

```js
imageWidth: width,
imageHeight: height,
```

Ví dụ:

```js
faces.push({
    embedding: normalized,
    landmarks,
    box: {
        left,
        top,
        width: boxWidth,
        height: boxHeight,
    },
    confidence: detection.confidence,

    imageWidth: width,
    imageHeight: height,
});
```

Sau đó khi tạo `clusterOutput`, KHÔNG lặp:

```text
imageWidth
imageHeight
```

trong từng face nếu có thể tránh.

Tôi muốn lưu chúng ở cấp `record`, ví dụ:

```js
{
    name: "...",
    url: "...",

    faceImageSize: {
        width: ...,
        height: ...
    },

    persons: [...]
}
```

Nếu tất cả face trong cùng một record dùng cùng processing image thì `faceImageSize` phải nằm ở record level.

---

# 7. CANVAS CROP

Khi browser load:

```js
record.url
```

hãy lấy:

```js
image.naturalWidth
image.naturalHeight
```

Sau đó convert:

```text
person.box
```

từ processing-image coordinates sang natural image coordinates.

Công thức:

```js
const scaleX =
    image.naturalWidth / record.faceImageSize.width;

const scaleY =
    image.naturalHeight / record.faceImageSize.height;
```

Sau đó:

```js
const sourceX =
    person.box.left * scaleX;

const sourceY =
    person.box.top * scaleY;

const sourceWidth =
    person.box.width * scaleX;

const sourceHeight =
    person.box.height * scaleY;
```

Canvas nên hiển thị crop dạng square.

Có thể thêm khoảng padding hợp lý quanh face, khoảng 20–35%, để không cắt sát mặt.

Ví dụ:

```text
detected box
     ↓
+-------------+
|             |
|   FACE      |
|             |
+-------------+

       ↓

square crop có padding
+-------------------+
|                   |
|      FACE         |
|                   |
+-------------------+
```

Crop phải được clamp để không vượt khỏi biên ảnh.

---

# 8. IMAGE CACHE

Một ảnh có thể chứa nhiều face.

Ví dụ một record có 10 face thì KHÔNG được load cùng một URL 10 lần nếu có thể tránh.

Hãy tạo cache:

```js
const imageCache = new Map();
```

và một function dạng:

```js
loadImage(url)
```

để nhiều Canvas crop dùng chung image đã load.

Mục tiêu:

```text
1 original image
        |
        +---- Canvas face 1
        +---- Canvas face 2
        +---- Canvas face 3
        +---- ...
```

---

# 9. ORIGINAL IMAGE

Report vẫn phải hiển thị original image của từng record như hiện tại.

Ví dụ:

```text
Cluster person-001

[original image]
DSC0001.JPG

[original image]
DSC0008.JPG

Face crops:

[face] [face] [face] [face]
[face] [face] [face]
```

Không bỏ phần original image hiện tại.

---

# 10. FACE CARD

Mỗi face card phải có:

```text
+----------------------+
|                      |
|    Canvas face crop  |
|                      |
+----------------------+
score 0.932
box 421,185,183x201
landmarks 462,244 | ...
```

Thông tin hiện tại:

* confidence
* box
* landmarks

phải tiếp tục được hiển thị.

Không cần hiển thị embedding.

---

# 11. SỬA DEBUG LOG [I] CỦA YuNet

Trong `detectAndEmbed()` hiện tại có đoạn DEBUG [I] tương tự:

```js
detection.landmarks.map((point) =>
    `${((point.x * width) / detectorSize).toFixed(0)},...`
)
```

Đoạn này SAI vì detector input 640x640 đang được letterbox bằng:

```js
fit: "contain"
```

Do đó phải tính landmark bằng cùng coordinate transform với phần [J].

Không được dùng:

```js
point.x * width / detectorSize
point.y * height / detectorSize
```

Hãy dùng:

```js
const toSourceX = value =>
    (value - detectorOffsetX) / detectorScale;

const toSourceY = value =>
    (value - detectorOffsetY) / detectorScale;
```

Sau đó tạo landmarks một lần:

```js
const landmarks = detection.landmarks.map((point) => ({
    x: toSourceX(point.x),
    y: toSourceY(point.y),
}));
```

Và DEBUG [I] phải log chính `landmarks` này.

Quan trọng:

**[I] log và [J] alignment phải sử dụng cùng một biến `landmarks`.**

Không được tính landmark hai lần bằng hai công thức khác nhau.

Mục tiêu là:

```text
YuNet 640x640 coordinates
          |
          | detectorOffset + detectorScale
          v
processing image coordinates
          |
          +---- DEBUG [I]
          |
          +---- alignment [J]
```

Như vậy log nhìn thấy chính xác tọa độ mà alignment thực sự sử dụng.

---

# 12. KHÔNG THAY ĐỔI THUẬT TOÁN KHÁC

Đây là refactor report + coordinate/debug fix.

Không tự ý thay đổi:

* YuNet model
* SFace model
* threshold
* NMS
* confidence
* clustering algorithm
* embedding normalization
* similarity transform
* face detection logic

trừ những thay đổi tối thiểu cần thiết cho yêu cầu trên.

Đặc biệt không được "cải tiến" clustering hoặc detection nếu không liên quan.

---

# 13. DATA FILE

`image-links-clusters.js` vẫn phải được `main()` sinh tự động.

Nó phải tiếp tục có dạng:

```js
const seriesData = [
    ...
];
```

Report JS chỉ consume `seriesData`.

Không đưa logic sinh data vào `face-clusters-report.js`.

Không hard-code cluster data trong HTML hoặc JS renderer.

---

# 14. FILE STRUCTURE CUỐI CÙNG

Tôi muốn kết quả cuối cùng rõ ràng như sau:

```text
report/
├── face-clusters-report.html
├── face-clusters-report.css
├── face-clusters-report.js
└── image-links-clusters.js
```

Trong đó:

### `face-clusters-report.html`

Chỉ chứa:

* document structure
* report skeleton
* CSS link
* script tags

### `face-clusters-report.css`

Chỉ chứa CSS.

### `face-clusters-report.js`

Chứa:

* group data
* DOM creation
* image loading/cache
* Canvas crop
* rendering

### `image-links-clusters.js`

Chỉ chứa generated data.

---

# 15. OUTPUT BẮT BUỘC

Sau khi sửa, hãy trả cho tôi:

1. Full `face-clusters-report.html`
2. Full `face-clusters-report.css`
3. Full `face-clusters-report.js`
4. Các đoạn code chính xác cần sửa trong `main()` / `detectAndEmbed()` để `image-links-clusters.js` có `faceImageSize`.
5. Đoạn sửa DEBUG [I] landmark.

Không chỉ mô tả chung chung.

Hãy đọc code hiện tại trước khi sửa và giữ nguyên naming/structure hiện có ở những chỗ không cần thay đổi.

Nếu có chỗ nào trong code hiện tại khác với giả định của prompt, hãy thích nghi theo code thực tế thay vì tạo một architecture hoàn toàn mới.
