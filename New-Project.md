# TASK: Refactor Image/Face-Clustering Tool thành Node.js Application + Person Alias Management + FE Filtering

## 0. VAI TRÒ

Bạn là AI coding agent đang làm việc trực tiếp trên một project Node.js/JavaScript hiện có.

**QUAN TRỌNG:**

Không được bắt đầu bằng việc tự viết lại project.

Trước tiên phải **đọc, phân tích và hiểu toàn bộ code hiện tại**, đặc biệt các file liên quan đến:

* `extract-onedrive-images.js`
* `extract-drive-images.js`
* `/image-onedrive-links-labeled.js`
* `/image-onedrive-links.js`
* `/face-label-poc.js`
* `/download-face-models.js`
* `/face-clusters-report.html`
* `/FE/index.html`
* `/FE/app.js`
* `/FE/seriesData.js`
* các file labeling / face detection / face clustering hiện có

Mục tiêu là **refactor và mở rộng hệ thống hiện tại**, không phá những phần đang hoạt động tốt.

Đặc biệt:

* Không tự ý thay đổi thuật toán face detection.
* Không tự ý thay đổi thuật toán face clustering.
* Không tự ý thay đổi threshold, distance, confidence hoặc logic merge cluster.
* Không thay đổi logic Swiper hiện tại nếu không cần thiết.
* Không thay đổi cách Playwright hiện tại hoạt động nếu chưa hiểu rõ mục đích của nó.
* Phải tận dụng tối đa code hiện tại.
* Nếu phát hiện vấn đề trong code cũ, hãy báo rõ trước khi thay đổi.

---

# 1. MỤC TIÊU TỔNG THỂ

Project hiện tại đang gồm các script JS chạy độc lập.

Bây giờ chuyển thành một **Node.js application có server**, nhưng vẫn giữ nguyên các chức năng hiện tại.

Application cần có 4 nhóm chính:

```text
extract/
labeling/
FE/
data/
```

Kiến trúc phải được thiết kế để sau này có thể mở rộng thêm nguồn ảnh mới.

Hiện tại có 2 nguồn:

1. Google Drive
2. OneDrive

Trong tương lai có thể thêm:

3. các image source khác

---

# 2. CẤU TRÚC FOLDER MONG MUỐN

Thiết kế project theo hướng:

```text
project/
│
├── server.js
│
├── extract/
│   ├── google-drive/
│   ├── onedrive/
│   └── ...
│
├── labeling/
│   └── existing labeling / face detection / clustering logic
│
├── FE/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── seriesData.js
│
├── data/
│   └── person-aliases.json
│
└── face-clusters-report/
    ├── index.html
    ├── app.js
    └── style.css
```

Tên folder/file có thể điều chỉnh nhỏ nếu cần để phù hợp code hiện tại, nhưng phải giữ nguyên 4 nhóm chức năng:

* Extract
* Labeling
* FE
* Data

---

# 3. EXTRACT - GOOGLE DRIVE

Hiện tại project có:

```text
extract-drive-images.js
```

Hãy đọc và hiểu toàn bộ logic hiện tại.

Đưa chức năng này vào Node.js application dưới:

```text
extract/google-drive/
```

Không được viết lại thuật toán một cách không cần thiết.

Mục tiêu là sau refactor, Node.js server có thể gọi chức năng Google Drive extraction thay vì phải chạy file JS độc lập.

Ví dụ về mặt kiến trúc có thể là:

```text
server.js
    ↓
Google Drive Extract Service
    ↓
existing extract-drive-images logic
```

Tên module/API cụ thể do bạn quyết định sau khi đọc code hiện tại.

---

# 4. EXTRACT - ONEDRIVE + PLAYWRIGHT

Hiện tại có:

```text
extract-onedrive-images.js
```

File này sử dụng Playwright, ví dụ:

```js
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
```

## Yêu cầu

Tích hợp chức năng này vào Node.js application.

Node.js server phải có khả năng gọi OneDrive extraction service.

Playwright vẫn được phép chạy với:

```js
headless: false
```

nếu workflow hiện tại cần browser có giao diện.

**Không được tự ý đổi thành `headless: true`.**

Trước khi refactor, phải hiểu:

* tại sao cần Playwright;
* workflow navigation hiện tại;
* login/session/cookie nếu có;
* cách lấy link;
* cách xử lý page;
* cách đóng browser;
* error handling.

Mục tiêu là chuyển từ:

```text
node extract-onedrive-images.js
```

sang:

```text
Node.js Server
      ↓
OneDrive Extract Service
      ↓
Playwright
      ↓
Existing extraction workflow
```

Nhưng hành vi hiện tại phải được bảo toàn.

---

# 5. DATA HIỆN TẠI

Hiện tại có file:

```text
/image-onedrive-links-labeled.js
```

File này chứa dữ liệu ảnh tương tự:

```js
const seriesData = [
  {
    name: "_DSC0556.JPG",
    id: "15cNBupqt9gO1WzAGdQHoR7CgmEwBnHwf",
    url: "https://drive.google.com/uc?export=view&id=15cNBupqt9gO1WzAGdQHoR7CgmEwBnHwf",
    persons: [
      "person-002",
      "person-001",
      "person-003"
    ]
  }
];
```

Trong đó:

* `name`: tên ảnh
* `id`: image ID
* `url`: URL ảnh
* `persons`: danh sách person ID xuất hiện trong ảnh

Person ID như:

```text
person-001
person-002
person-003
```

là ID nội bộ.

**Không được đổi chúng thành alias.**

Ví dụ không được biến:

```js
persons: ["person-001"]
```

thành:

```js
persons: ["Chú"]
```

Person ID phải luôn giữ nguyên.

---

# 6. PERSISTENT PERSON ALIAS

Đây là yêu cầu rất quan trọng.

Không dùng:

```text
FE/seriesData.js
```

làm database/source chính cho alias.

Không được bắt user mỗi lần mở trang quản lý phải nhập lại alias.

Tạo persistent data:

```text
data/person-aliases.json
```

Ví dụ:

```json
{
  "person-001": {
    "alias": "Chú"
  },
  "person-002": {
    "alias": "Cô Lan"
  },
  "person-003": {
    "alias": ""
  }
}
```

`person-aliases.json` là nguồn lưu alias chính thức.

Khi user:

* mở trang quản lý;
* đóng browser;
* restart Node.js;
* mở lại trang;

alias cũ phải được load lại.

Nếu một person mới xuất hiện trong dữ liệu mà chưa có alias:

```json
{
  "person-004": {
    "alias": ""
  }
}
```

hoặc tương đương.

Không được xóa alias của person cũ chỉ vì person đó không xuất hiện trong một batch extraction mới, trừ khi user chủ động yêu cầu xóa.

---

# 7. PERSON MANAGEMENT UI

Tạo trang quản lý person/alias.

Có thể đặt tại:

```text
/index.html
```

Trang này chạy thông qua Node.js server.

Trang phải:

1. đọc danh sách person từ dữ liệu clustering/labeling hiện tại;
2. load alias từ:

```text
/data/person-aliases.json
```

3. hiển thị từng person;
4. cho phép sửa alias;
5. Save alias về server;
6. Generate lại FE data.

---

# 8. TẬN DỤNG FACE CLUSTERS REPORT HIỆN TẠI

Project hiện tại có:

```text
/face-clusters-report.html
```

Hãy **đọc và hiểu file này trước khi viết code**.

Report hiện tại đã có thông tin rất hữu ích về cluster/person, bao gồm:

* person/cluster ID;
* số lượng face;
* original image;
* face/aligned image;
* score;
* bbox;
* landmark/các thông tin detection liên quan.

Không được vứt bỏ logic/data hiện có chỉ vì tạo UI mới.

## Refactor report

Thay vì một HTML lớn chứa toàn bộ UI/CSS/JS, chuyển thành folder riêng:

```text
face-clusters-report/
├── index.html
├── app.js
└── style.css
```

Tách:

* HTML
* CSS
* JavaScript

thành các file riêng.

---

# 9. FACE CLUSTERS REPORT PHẢI TRỞ THÀNH UI CÓ THỂ TƯƠNG TÁC

Report mới phải cho user xem:

* person ID;
* alias nếu có;
* số lượng face;
* representative/preview face;
* các ảnh liên quan;
* thông tin cluster hiện tại nếu đang có.

Ví dụ:

```text
Face Clusters Report

Person:
[ All persons ▼ ]

--------------------------------

person-001
Alias: Chú
7 faces

[ representative face ]

--------------------------------

person-002
Alias: Cô Lan
15 faces
```

Nếu chưa có alias:

```text
person-003
Alias: person-003
```

hoặc hiển thị:

```text
person-003
```

Không được để alias rỗng làm mất person khỏi UI.

---

# 10. COMBOBOX PERSON

Có combobox/filter person trong Face Clusters Report.

Ví dụ:

```text
Person:
[ All persons ▼ ]
```

Options:

```text
All persons
Chú
Cô Lan
person-003
person-004
```

Quy tắc:

* Có alias → hiển thị alias.
* Chưa có alias → hiển thị person ID.
* Giá trị thực sự dùng để filter phải là person ID.

Ví dụ:

```text
display = "Chú"
value = "person-001"
```

Không filter bằng alias.

---

# 11. ALIAS MANAGEMENT CÓ THỂ TẬN DỤNG FACE CLUSTER UI

Trang quản lý alias nên tận dụng dữ liệu của Face Clusters Report.

Mục tiêu:

User nhìn vào representative face/cluster và biết:

```text
person-001 = Chú
person-002 = Cô Lan
person-003 = ?
```

Sau đó nhập alias.

Có thể hiển thị:

```text
┌───────────────────────────────────┐
│ person-001                        │
│                                   │
│ [ representative face ]           │
│                                   │
│ 7 faces                           │
│                                   │
│ Alias: [ Chú                 ]    │
└───────────────────────────────────┘
```

Không bắt buộc phải copy nguyên UI hiện tại; hãy tái sử dụng những phần hữu ích của report.

---

# 12. SAVE ALIAS

Có API Node.js.

Ví dụ:

```text
GET  /api/persons
GET  /api/person-aliases
POST /api/person-aliases
```

API cụ thể có thể thiết kế tốt hơn nếu cần.

Khi user bấm:

```text
Save All
```

server cập nhật:

```text
data/person-aliases.json
```

Không chỉ lưu vào browser/localStorage.

LocalStorage không phải source of truth.

Server-side JSON mới là source of truth.

---

# 13. GENERATE /FE/seriesData.js

Đây là yêu cầu BẮT BUỘC.

Phải có nút:

```text
[ Generate FE Data ]
```

Khi click:

Node.js server phải:

1. đọc source data hiện tại:

   ```text
   /image-onedrive-links-labeled.js
   ```

2. đọc:

   ```text
   /data/person-aliases.json
   ```

3. generate:

```text
/FE/seriesData.js
```

**Không được chỉ download file về browser.**

Server phải ghi trực tiếp file:

```text
/FE/seriesData.js
```

---

# 14. CẤU TRÚC /FE/seriesData.js

Generated file phải giữ nguyên `persons` bằng person ID.

Ví dụ:

```js
const personAliases = {
  "person-001": "Chú",
  "person-002": "Cô Lan",
  "person-003": ""
};

const seriesData = [
  {
    name: "_DSC0556.JPG",
    id: "15cNBupqt9gO1WzAGdQHoR7CgmEwBnHwf",
    url: "https://drive.google.com/uc?export=view&id=15cNBupqt9gO1WzAGdQHoR7CgmEwBnHwf",
    persons: [
      "person-002",
      "person-001",
      "person-003"
    ]
  }
];
```

Tên export/global/module có thể giữ phù hợp với code FE hiện tại.

**Không phá cách `/FE/app.js` đang consume `seriesData.js`.**

Nếu cần thay đổi module format, phải sửa FE tương ứng một cách có kiểm soát.

---

# 15. FE PHOTO VIEWER

Hiện tại:

```text
/FE/index.html
/FE/app.js
```

dùng Swiper.js.

Phải giữ Swiper.

Không thay toàn bộ gallery bằng framework/library khác.

---

# 16. PERSON FILTER TRONG FE

Thêm combobox vào `/FE/index.html`.

Ví dụ:

```text
Person:
[ All persons ▼ ]
```

Options:

```text
All persons
Chú
Cô Lan
person-003
```

Quy tắc:

```text
option.value = person ID
option.text = alias nếu có, nếu không thì person ID
```

Khi chọn:

```text
person-001
```

chỉ hiển thị các ảnh mà:

```js
image.persons.includes("person-001")
```

Khi chọn:

```text
All persons
```

hiển thị toàn bộ ảnh.

Nếu một ảnh có nhiều person:

```js
persons: [
  "person-001",
  "person-003"
]
```

thì ảnh đó phải xuất hiện khi chọn:

* person-001
* person-003

---

# 17. KHÔNG LÀM THAY ĐỔI DATA MODEL KHÔNG CẦN THIẾT

Giữ nguyên:

```js
persons: [
  "person-001",
  "person-002"
]
```

Alias là metadata riêng.

Không duplicate alias vào từng image record nếu không cần thiết.

Mục tiêu:

```text
person ID
   ↓
personAliases
   ↓
display name
```

---

# 18. NODE.JS SERVER

Tạo Node.js server làm trung tâm.

Server chịu trách nhiệm:

* serve static FE;
* serve alias management UI;
* serve face-clusters-report;
* expose APIs;
* run Google Drive extraction;
* run OneDrive extraction;
* run Playwright;
* read/write persistent data;
* generate `/FE/seriesData.js`.

Không cần sử dụng database SQL ở giai đoạn này.

JSON file là đủ:

```text
data/person-aliases.json
```

---

# 19. EXTRACTION OUTPUT

Không được phá file:

```text
image-onedrive-links-labeled.js
```

nếu các bước labeling hiện tại đang phụ thuộc vào nó.

Nếu cần thay đổi output architecture, phải đảm bảo backward compatibility hoặc có migration rõ ràng.

---

# 20. LABELING / CLUSTERING

Đây là phần rất nhạy cảm.

Hiện tại face detection/clustering đã được debug và đang hoạt động.

**KHÔNG được tự ý sửa thuật toán.**

Giữ nguyên:

* face detection;
* landmark validation;
* confidence;
* NMS;
* embeddings;
* distance;
* threshold;
* clustering;
* merge logic;
* person ID generation.

Chỉ refactor thành module/service nếu cần để Node.js gọi được.

Nếu phải thay đổi bất kỳ thuật toán nào:

1. báo lý do;
2. mô tả code cũ;
3. mô tả code mới;
4. không tự ý thay đổi threshold.

---

# 21. ARCHITECTURE PHẢI MỞ RỘNG ĐƯỢC

Extract source phải có abstraction đủ sạch để sau này thêm:

```text
Google Drive
OneDrive
iCloud
...
```

Ví dụ:

```text
extract/
├── google-drive/
├── onedrive/
└── icloud/
```

Nhưng **không cần implement iCloud bây giờ**.

Chỉ cần architecture không khóa chặt vào Google Drive/OneDrive.

---

# 22. UI FLOW MONG MUỐN

Trang quản lý chính:

```text
/index.html
```

có thể có:

```text
Person Management

[ Refresh ]

Person list
--------------------------------
person-001
[ representative face ]
Alias: [ Chú ]

person-002
[ representative face ]
Alias: [ Cô Lan ]

person-003
[ representative face ]
Alias: [                ]
--------------------------------

[ Save All ]

[ Generate FE Data ]
```

Sau Save:

```text
✓ Alias saved
```

Sau Generate:

```text
✓ /FE/seriesData.js generated
```

---

# 23. DATA FLOW CUỐI CÙNG

Architecture mong muốn:

```text
             ┌─────────────────┐
             │   Google Drive  │
             └────────┬────────┘
                      │
             ┌────────▼────────┐
             │ extract/google  │
             └────────┬────────┘
                      │
                      │
             ┌────────▼────────┐
             │    OneDrive     │
             │   + Playwright  │
             └────────┬────────┘
                      │
                      ▼
          image-onedrive-links-labeled.js
                      │
                      ▼
                 labeling/
                      │
             face detection/
             face clustering/
                      │
          ┌───────────┴────────────┐
          │                        │
          ▼                        ▼
 face-clusters-report/     person-aliases.json
          │                        │
          └───────────┬────────────┘
                      │
                      ▼
                Node.js Server
                      │
                      ▼
             Generate FE Data
                      │
                      ▼
             /FE/seriesData.js
                      │
                      ▼
                 FE Swiper
                      │
                      ▼
              Person Combobox
                      │
                      ▼
                Filter images
```

---

# 24. TRƯỚC KHI CODE: PHẢI PHÂN TÍCH

Trước khi thay đổi code, hãy báo cáo:

## A. Existing files

Liệt kê:

* file nào đang làm extraction;
* file nào đang labeling;
* file nào đang clustering;
* file nào generate report;
* file nào generate `image-onedrive-links-labeled.js`;
* FE hiện tại load data như thế nào;
* Swiper hiện tại được khởi tạo như thế nào.

## B. Existing dependencies

Kiểm tra:

```text
package.json
```

và xác định:

* Node version nếu có;
* Playwright;
* Swiper;
* các face/AI libraries;
* các dependencies hiện tại.

Không thêm dependency nếu không cần.

## C. Existing data flow

Mô tả chính xác:

```text
input
→ extraction
→ labeling
→ clustering
→ output
→ FE
```

## D. Risks

Chỉ ra những phần có nguy cơ bị break khi refactor.

Sau khi phân tích xong mới bắt đầu implementation.

---

# 25. TESTING

Sau khi implementation:

## Test 1

Start Node.js server.

Kiểm tra tất cả page:

```text
/
 /FE/
 /face-clusters-report/
```

## Test 2

Load person list.

## Test 3

Load existing aliases.

Restart server.

Kiểm tra aliases vẫn còn.

## Test 4

Đổi:

```text
person-001 → Chú
```

Save.

Refresh.

Alias vẫn phải là:

```text
Chú
```

## Test 5

Generate:

```text
/FE/seriesData.js
```

Kiểm tra file tồn tại và syntax hợp lệ.

## Test 6

FE load `seriesData.js`.

## Test 7

Combobox hiển thị:

```text
Chú
Cô Lan
person-003
```

## Test 8

Filter `person-001`.

Chỉ ảnh chứa:

```js
"person-001"
```

được hiển thị.

## Test 9

Filter `person-003`.

## Test 10

Select All.

Tất cả ảnh quay lại.

## Test 11

Một ảnh có nhiều persons phải xuất hiện ở tất cả person filter tương ứng.

## Test 12

Run Google Drive extraction.

## Test 13

Run OneDrive extraction.

## Test 14

Kiểm tra Playwright workflow vẫn hoạt động đúng như trước.

---

# 26. QUAN TRỌNG: KHÔNG XÓA FILE CŨ NGAY

Trong quá trình migration:

* Không xóa script cũ trước khi chức năng mới chạy được.
* Có thể giữ compatibility wrappers nếu cần.
* Chỉ xóa file cũ khi chắc chắn không còn dependency.
* Nếu đổi đường dẫn, phải cập nhật toàn bộ references.

---

# 27. ERROR HANDLING

Node.js API phải có error handling rõ ràng.

Ví dụ:

```text
Extraction failed
Playwright failed
Invalid alias data
Generate failed
File write failed
```

Không được silently fail.

UI phải nhận được thông báo thành công/thất bại.

---

# 28. SECURITY / FILE WRITE

Server chỉ được phép ghi các file/data mà application quản lý.

Đặc biệt:

```text
data/person-aliases.json
FE/seriesData.js
```

Không tạo API kiểu arbitrary file path có thể ghi bất kỳ file nào trên máy.

---

# 29. KHÔNG OVER-ENGINEER

Không cần:

* React;
* Vue;
* database;
* Docker;
* authentication;
* cloud deployment;

trừ khi code hiện tại đã có sẵn và thật sự cần.

Ưu tiên:

```text
Node.js
Express hoặc HTTP server phù hợp
HTML
CSS
Vanilla JS
Playwright
Swiper hiện tại
JSON persistence
```

---

# 30. KẾT QUẢ CUỐI CÙNG MONG MUỐN

Sau khi hoàn thành, project phải trở thành một Node.js application trong đó:

### Extract

Có thể chạy:

```text
Google Drive extraction
OneDrive extraction + Playwright
```

từ Node.js server.

### Labeling

Giữ nguyên face detection/clustering hiện tại.

### Person Management

Có UI để:

```text
person-001 → Chú
person-002 → Cô Lan
person-003 → ...
```

Alias được lưu persistent tại:

```text
data/person-aliases.json
```

### Face Cluster Report

Có:

* person ID;
* alias;
* face count;
* preview/representative face;
* cluster information;
* person combobox/filter.

### FE

Giữ nguyên Swiper.

Có combobox person.

Filter ảnh theo `persons`.

Hiển thị alias nếu có.

Fallback về person ID nếu chưa có alias.

### Generate

Có nút:

```text
Generate FE Data
```

và Node.js server generate trực tiếp:

```text
/FE/seriesData.js
```

---

# 31. QUY TẮC CUỐI CÙNG

Một lần nữa:

**Đừng viết code ngay.**

Hãy:

1. Inspect project.
2. Đọc các file hiện tại.
3. Hiểu workflow.
4. Vẽ architecture hiện tại.
5. Xác định dependencies.
6. Xác định những gì cần refactor.
7. Xác định những gì phải giữ nguyên.
8. Đưa ra implementation plan.
9. Sau khi plan rõ ràng mới code.
10. Test từng phần.
11. Báo cáo chính xác các file đã tạo/sửa.
12. Báo cáo các vấn đề còn tồn tại.

Ưu tiên **bảo toàn chức năng hiện tại + mở rộng architecture**, không phải viết lại từ đầu.

