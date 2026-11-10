// EVOLVE アイコン画像（PNG）を icons/icon.svg から作り直すためのスクリプト
// 使い方: node tools/generate-icons.js  （Node.js と Playwright が必要）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
const targets = [
  ['icons/apple-touch-icon.png', 180],
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/icon-maskable-512.png', 512],
  ['icons/favicon-32.png', 32],
];

(async () => {
  const browser = await chromium.launch();
  for (const [file, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`
    );
    await page.screenshot({ path: path.join(root, file), omitBackground: false });
    await page.close();
    console.log('created', file);
  }
  await browser.close();
})();
