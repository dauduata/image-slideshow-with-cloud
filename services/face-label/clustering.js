function cosineDistance(first, second) {
  if (first.length !== second.length) throw new Error(`Embedding dimension mismatch: ${first.length} vs ${second.length}`);
  return 1 - first.reduce((sum, value, index) => sum + value * second[index], 0);
}

function cluster(embeddings, imageIds, threshold, debugPair = null) {
  const distanceMatrix = Array.from({ length: embeddings.length }, () => Array(embeddings.length).fill(0));
  for (let first = 0; first < embeddings.length; first += 1)
    for (let second = first + 1; second < embeddings.length; second += 1) {
      const distance = cosineDistance(embeddings[first], embeddings[second]);
      distanceMatrix[first][second] = distance;
      distanceMatrix[second][first] = distance;
    }
  let minDistance = Infinity;
  let maxDistance = -Infinity;
  let distanceSum = 0;
  let distanceCount = 0;
  for (let first = 0; first < embeddings.length; first += 1)
    for (let second = first + 1; second < embeddings.length; second += 1) {
      const distance = distanceMatrix[first][second];
      minDistance = Math.min(minDistance, distance);
      maxDistance = Math.max(maxDistance, distance);
      distanceSum += distance;
      distanceCount += 1;
    }
  console.log(`[CLUSTER] START faces=${embeddings.length} threshold=${threshold} pairs=${distanceCount} min=${(distanceCount ? minDistance : 0).toFixed(4)} avg=${(distanceCount ? distanceSum / distanceCount : 0).toFixed(4)} max=${(distanceCount ? maxDistance : 0).toFixed(4)}`);
  const tracedPair = debugPair ? String(debugPair).split(",").map(Number) : null;
  if (tracedPair && embeddings[tracedPair[0]] && embeddings[tracedPair[1]]) {
    const [first, second] = tracedPair;
    const neighbors = [];
    for (let index = 0; index < embeddings.length; index += 1)
      if (index !== first && distanceMatrix[first][index] <= threshold)
        neighbors.push(`${index}:${distanceMatrix[first][index].toFixed(6)}`);
    console.log(`[CLUSTER TRACE] pair=${first},${second} direct=${distanceMatrix[first][second].toFixed(6)} neighborsOfFirst=[${neighbors.join(",")}] corePoint=not-used`);
  }
  let clusters = embeddings.map((_, index) => [index]);
  let mergeCount = 0;
  let sameImageRejected = 0;
  while (true) {
    let bestPair = null;
    let bestDistance = Infinity;
    for (let first = 0; first < clusters.length; first += 1)
      for (let second = first + 1; second < clusters.length; second += 1) {
        const imagesInFirstCluster = new Set(clusters[first].map((index) => imageIds[index]));
        if (clusters[second].some((index) => imagesInFirstCluster.has(imageIds[index]))) {
          if (tracedPair && (clusters[first].includes(tracedPair[0]) || clusters[second].includes(tracedPair[0])) && (clusters[first].includes(tracedPair[1]) || clusters[second].includes(tracedPair[1])))
            console.log(`[CLUSTER TRACE] reject-traced-pair clusters=${first},${second} reason=same-image membersA=[${clusters[first].join(",")}] membersB=[${clusters[second].join(",")}]`);
          sameImageRejected += 1;
          continue;
        }
        let completeDistance = 0;
        for (const firstIndex of clusters[first])
          for (const secondIndex of clusters[second]) completeDistance = Math.max(completeDistance, distanceMatrix[firstIndex][secondIndex]);
        if (completeDistance < bestDistance || (completeDistance === bestDistance && (bestPair === null || first < bestPair[0] || (first === bestPair[0] && second < bestPair[1])))) {
          bestDistance = completeDistance;
          bestPair = [first, second];
        }
      }
    if (bestPair === null) break;
    const [first, second] = bestPair;
    if (tracedPair) {
      const tracedClusters = clusters.map((members, index) => ({ index, members })).filter(({ members }) => members.includes(tracedPair[0]) || members.includes(tracedPair[1])).map(({ index, members }) => `${index}=[${members.join(",")}]`).join(" ");
      console.log(`[CLUSTER TRACE] candidate=${first},${second} complete=${bestDistance.toFixed(6)} traced=${tracedClusters}`);
    }
    if (bestDistance > threshold) {
      console.log(`[CLUSTER] STOP threshold distance=${bestDistance.toFixed(4)} threshold=${threshold} A=[${clusters[first].join(",")}] B=[${clusters[second].join(",")}]`);
      break;
    }
    const pairDistances = [];
    for (const firstIndex of clusters[first])
      for (const secondIndex of clusters[second])
        pairDistances.push({ firstIndex, secondIndex, distance: distanceMatrix[firstIndex][secondIndex] });
    pairDistances.sort((left, right) => right.distance - left.distance);
    console.log(`[CLUSTER] MERGE #${mergeCount + 1} complete=${bestDistance.toFixed(4)} threshold=${threshold} A=[${clusters[first].join(",")}] B=[${clusters[second].join(",")}]`);
    for (const pair of pairDistances)
      console.log(`  face ${pair.firstIndex} (image=${imageIds[pair.firstIndex]}) <-> face ${pair.secondIndex} (image=${imageIds[pair.secondIndex]}) distance=${pair.distance.toFixed(4)}`);
    clusters[first] = [...clusters[first], ...clusters[second]];
    clusters.splice(second, 1);
    mergeCount += 1;
  }
  const labels = Array(embeddings.length).fill(-1);
  clusters.sort((first, second) => first[0] - second[0]).forEach((members, label) => members.forEach((index) => { labels[index] = label; }));
  console.log(`[CLUSTER] DONE groups=${clusters.length} merges=${mergeCount} sameImageRejected=${sameImageRejected}`);
  return labels;
}

module.exports = { cluster, cosineDistance };
