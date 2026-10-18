import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.resolve(__dirname, '../public');
const svgPath = path.join(publicDir, 'favicon.svg');
const svgContent = fs.readFileSync(svgPath, 'utf8');

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; overflow: hidden; }
    svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>
`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const sizes = [
    { name: 'icon-192.png', width: 192, height: 192 },
    { name: 'icon-512.png', width: 512, height: 512 },
    { name: 'apple-touch-icon.png', width: 180, height: 180 },
    { name: 'favicon-32.png', width: 32, height: 32 },
  ];

  for (const { name, width, height } of sizes) {
    await page.setViewportSize({ width, height });
    await page.setContent(htmlContent);
    const outputPath = path.join(publicDir, name);
    await page.screenshot({ path: outputPath, omitBackground: true });
    console.log(`Generated ${name} (${width}x${height})`);
  }

  // Copy favicon-32.png as favicon.ico fallback for legacy icon readers
  const icoPath = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(path.join(publicDir, 'favicon-32.png'), icoPath);
  console.log('Copied favicon.ico fallback');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
