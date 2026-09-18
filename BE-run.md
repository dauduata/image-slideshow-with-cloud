// ghi các lệnh BE có thể chạy:

```powershell
yarn download-face-models
```


```powershell
node services/face-label/runner.js `
	--input image-links.js `
	--output image-links-labeled.js `
	--clusterOutput report/image-links-clusters.js `
	--report face-clusters-report/index.html `
	--concurrency 3 `
	--threshold 0.45 `
	--timeout 30000 `
	--maxDimension 1600
```

```powershell
node face-label-poc.js `
	--input image-links.js `
	--output image-links-labeled.js `
	--clusterOutput report/image-links-clusters.js `
	--report face-clusters-report/index.html `
	--concurrency 3 `
	--threshold 0.45 `
	--timeout 30000 `
	--maxDimension 1600
```