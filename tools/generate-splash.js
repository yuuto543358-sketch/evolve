// iPhoneでホーム画面から開いたときの起動画面（スプラッシュ画像）を作るスクリプト
// 使い方: node tools/generate-splash.js  （Node.js と Playwright が必要）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// [CSS幅, CSS高さ, 画素密度]
const DEVICES = [
  [440, 956, 3], // iPhone 16 Pro Max
  [402, 874, 3], // iPhone 16 Pro
  [430, 932, 3], // iPhone 14/15 Pro Max, 15/16 Plus
  [393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [390, 844, 3], // iPhone 12/13/14
  [375, 812, 3], // iPhone X/XS/11 Pro, 12/13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone SE (第2/3世代), 8
];

const mark = fs.readFileSync(path.join(root, 'icons/logo-mark.svg'), 'utf8');

(async () => {
  const outDir = path.join(root, 'icons/splash');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const links = [];
  for (const [w, h, dpr] of DEVICES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await page.setContent(`<html><body style="margin:0;background:#F3F5F4;height:100vh;display:grid;place-content:center;justify-items:center;gap:18px;font-family:-apple-system,'Segoe UI',sans-serif">
      ${mark.replace('<svg', '<svg width="84" height="84"')}
      <div style="font-weight:700;letter-spacing:.42em;padding-left:.42em;font-size:15px;color:#1C2221">EVOLVE</div>
    </body></html>`);
    const name = `splash-${w * dpr}x${h * dpr}.png`;
    await page.screenshot({ path: path.join(outDir, name) });
    await page.close();
    links.push(`  <link rel="apple-touch-startup-image" href="./icons/splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`);
    console.log('created', name);
  }
  await browser.close();
  console.log('\nindex.html に貼るタグ:\n' + links.join('\n'));
})();
