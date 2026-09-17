node face-label-poc.js --input image-links.js --output image-links-labeled.js --report  face-clusters-report.html --concurrency 3 --threshold 0.45 --timeout 30000 --maxDimension 1600 --limit 5 --debug true    --clusterPair 0,10 2>&1 | tee face-label-poc.log   


node face-label-poc.js --input image-links.js --output image-links-labeled.js --report  face-clusters-report.html   --name "sna-october-53.jpg" --concurrency 1 --threshold 0.45 --timeout 30000 --maxDimension 1600 --debug true 2>&1 | tee face-label-poc.log   

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