node face-label-poc.js --input image-links.js --output image-links-labeled.js --report  face-clusters-report.html --concurrency 3 --threshold 0.45 --timeout 30000 --maxDimension 1600 --limit 5 --debug true    --clusterPair 0,10 2>&1 | tee face-label-poc.log   


node face-label-poc.js --input image-links.js --output image-links-labeled.js --report  face-clusters-report.html   --name "sna-october-53.jpg" --concurrency 1 --threshold 0.45 --timeout 30000 --maxDimension 1600 --debug true 2>&1 | tee face-label-poc.log   


// Ghi chú: tên file có phân biệt hoa thường
node face-label-poc.js \
  --input image-links.js \
  --output image-links-labeled.js \
  --report face-clusters-report.html \
  --name "sna-october-53.jpg" \
  --name "sna-october-52.jpg" \
  --name "sna-october-60.jpg" \
  --concurrency 1 \
  --threshold 0.45 \
  --timeout 30000 \
  --maxDimension 1600 \
  --debug true  2>&1 | tee face-label-poc.log  



node face-label-poc.js \
  --input image-links.js \
  --output image-links-labeled.js \
  --report face-clusters-report.html \
  --name "_DSC0619.JPG" \
  --name "_DSC0620.JPG" \
  --name "_DSC0617.JPG" \
  --name "_DSC0618.JPG" \
  --concurrency 1 \
  --threshold 0.45 \
  --timeout 30000 \
  --maxDimension 1600 \
  --debug true  2>&1 | tee face-label-poc.log  

node face-label-poc.js --input image-links.js --output image-links-labeled.js --report  face-clusters-report.html   --name "_DSC0615.JPG" --name "_DSC0596.JPG" --concurrency 1 --threshold 0.45 --timeout 30000 --maxDimension 1600 --debug true 2>&1 | tee face-label-poc.log 