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
│   └── existing face clustering / labeling logic
│
├── FE/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── seriesData.js          ← GENERATED
│
├── data/
│   └── person-aliases.json    ← PERSISTENT SOURCE
│
└── face-clusters-report/
    ├── index.html
    ├── app.js
    └── style.css