const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const IMAGE_PATTERN = /\.(jpg|jpeg|png|gif|webp|avif)$/i;

function printUsage() {
  console.log('Usage: node extract-onedrive-images.js <onedrive-folder-url> [output-file.js]');
  console.log('Example: node extract-onedrive-images.js "https://1drv.ms/f/..." image-links.js');
}

function getJavaScriptOutputPath(outputFile) {
  return outputFile.replace(/\.json$/i, '.js');
}

async function main() {
  const folderUrl = process.argv[2];
  const outputFile = process.argv[3] || 'image-links.js';

  if (!folderUrl) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('[data-automationid="ItemTile"]').first().waitFor({ timeout: 60_000 });

    const scrollContainer = page.locator('[data-automationid="ItemTile"]').first().locator('xpath=ancestor::div[contains(@class, "scrollContainer_")]');
    const imagesById = new Map();
    let previousScrollTop = -1;
    let stablePasses = 0;
    for (let pass = 0; pass < 240 && stablePasses < 8; pass += 1) {
      const visibleImages = await page.locator('[data-automationid="ItemTile"]').evaluateAll((tiles) => {
        const imagePattern = /\.(jpg|jpeg|png|gif|webp|avif)$/i;
        return tiles.flatMap((tile) => {
          const name = tile.querySelector('[data-automationid="name"]')?.getAttribute('title');
          const sourceKey = tile.parentElement?.getAttribute('data-drag-source-key');
          const thumbnailUrl = tile.querySelector('img')?.getAttribute('src');
          if (!name || !sourceKey || !thumbnailUrl || !imagePattern.test(name)) return [];
          try {
            const itemId = JSON.parse(sourceKey)[3];
            return itemId ? [{ name, id: itemId, url: `https://onedrive.live.com/download?resid=${encodeURIComponent(itemId)}`, thumbnailUrl }] : [];
          } catch { return []; }
        });
      });
      for (const image of visibleImages) imagesById.set(image.id, image);

      await scrollContainer.hover();
      await page.mouse.wheel(0, 1000);
      await scrollContainer.evaluate((element) => element.dispatchEvent(new Event('scroll', { bubbles: true })));
      await page.waitForTimeout(1000);
      const scrollTop = await scrollContainer.evaluate((element) => element.scrollTop);
      stablePasses = scrollTop === previousScrollTop ? stablePasses + 1 : 0;
      previousScrollTop = scrollTop;
    }

    const images = [...imagesById.values()];

    if (images.length === 0) {
      throw new Error('No public images found. Check the sharing permission and folder URL.');
    }

    const outputPath = path.resolve(getJavaScriptOutputPath(outputFile));
    const output = `const seriesData = ${JSON.stringify(images, null, 2)};\n`;
    await fs.writeFile(outputPath, output, 'utf8');
    console.log(`Extracted ${images.length} image link(s) to ${outputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
