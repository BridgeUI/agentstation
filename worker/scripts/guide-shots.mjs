// 使い方ガイドのスクリーンショット（public/guide/ の dashboard-overview / env-tabs / connect-tab / ops-tab）。
// ローカルの wrangler dev（見本データ ui/dev-seed.sql）を Google Chrome（headless）で開いて撮る。
// playwright-core はこのリポジトリの依存に入れていない。作業用フォルダに入れて、そこから実行する:
//   mkdir -p /tmp/guide-shots && cd /tmp/guide-shots && npm init -y && npm i playwright-core
//   （worker/ で）npx wrangler d1 migrations apply agentstation --local
//                 npx wrangler d1 execute agentstation --local --file ui/dev-seed.sql
//                 npm run dev   ← 別の端末で
//   cp worker/scripts/guide-shots.mjs /tmp/guide-shots/ && node /tmp/guide-shots/guide-shots.mjs worker/public/guide
// 撮る人は .dev.vars の LOCAL_DEV_EMAIL（オーナー）。オーナーだけに出るものは写さないよう隠している。
/* global process, document, console */
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'public/guide';
const BASE = 'http://localhost:8787';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
async function page(width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  return ctx.newPage();
}
const pad = (b, p = 0) => ({
  x: Math.max(0, b.x - p),
  y: Math.max(0, b.y - p),
  width: b.width + p * 2,
  height: b.height + p * 2,
});

// 1. 一覧
{
  const p = await page(1400, 867);
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#env-body tr');
  await p.waitForTimeout(800);
  // 利用者向けのガイドなので、オーナーにだけ出るボタンと host の基礎設定の注意は写さない
  await p.evaluate(() => {
    for (const id of ['notify-test', 'notify-test-result', 'banners']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
  });
  await p.screenshot({ path: `${OUT}/dashboard-overview.jpg`, type: 'jpeg', quality: 85 });
}
// 2. 環境ページの見出しとタブ（vm1）
{
  const p = await page(1100, 900);
  await p.goto(`${BASE}/vm1.html#rc`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#state-rows .tile', { state: 'attached' });
  await p.waitForTimeout(800);
  const head = await p.locator('#env-title').boundingBox();
  const tabs = await p.locator('.tabs').boundingBox();
  const x = tabs.x - 16,
    y = head.y - 24;
  await p.screenshot({
    path: `${OUT}/env-tabs.jpg`,
    type: 'jpeg',
    quality: 85,
    clip: { x, y, width: tabs.width + 32, height: tabs.y + tabs.height - y + 16 },
  });
}
// 3. 接続タブ（vm1）
{
  const p = await page(1100, 900);
  await p.goto(`${BASE}/vm1.html#connect`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#conn-body .cols-2');
  await p.waitForTimeout(800);
  const b = await p.locator('#conn-body .cols-2').boundingBox();
  await p.screenshot({
    path: `${OUT}/connect-tab.jpg`,
    type: 'jpeg',
    quality: 85,
    clip: pad(b, 12),
  });
}
// 4. 操作タブ（vm1）
{
  const p = await page(1100, 1000);
  await p.goto(`${BASE}/vm1.html#ops`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#ops-body tr');
  await p.waitForTimeout(800);
  const b = await p.locator('#ops-sec').boundingBox();
  await p.screenshot({ path: `${OUT}/ops-tab.jpg`, type: 'jpeg', quality: 85, clip: pad(b, 12) });
}
await browser.close();
console.warn('ok');
