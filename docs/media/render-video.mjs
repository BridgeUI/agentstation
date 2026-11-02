// docs/media/overview.{en,ja}.svg を 1 コマずつ撮り、MP4 と GIF に書き出す。
// 要るもの：Google Chrome、ffmpeg、playwright-core（このリポジトリの依存には入れていない。作業用フォルダに入れて実行する）
//   mkdir -p /tmp/guide-shots && cd /tmp/guide-shots && npm init -y && npm i playwright-core
//   cp docs/media/render-video.mjs /tmp/guide-shots/ && node /tmp/guide-shots/render-video.mjs "$PWD/docs/media"
// 出力：docs/media/overview.{en,ja}.mp4（1920×1080・30fps）と overview.{en,ja}.gif（960×540・15fps）
/* global document */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const DIR = process.argv[2];
if (!DIR) throw new Error('docs/media の絶対パスを渡す');
const SECONDS = 18; // overview.mjs の T と同じ
const FPS = 30;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

for (const lang of ['en', 'ja']) {
  const frames = mkdtempSync(join(tmpdir(), `overview-${lang}-`));
  const ctx = await browser.newContext({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${join(DIR, `overview.${lang}.svg`)}`);
  const total = SECONDS * FPS;
  for (let i = 0; i < total; i++) {
    await page.evaluate(
      (ms) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = ms;
        }
      },
      (i * 1000) / FPS,
    );
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
  }
  await ctx.close();

  const input = join(frames, 'f%04d.png');
  const mp4 = join(DIR, `overview.${lang}.mp4`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    mp4,
  ]);
  // GIF は 2 パス（パレットを作ってから）。文字がにじまないようディザは控えめに
  const palette = join(frames, 'palette.png');
  const vf = 'fps=15,scale=960:-1:flags=lanczos';
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-vf',
    `${vf},palettegen=max_colors=128:stats_mode=diff`,
    palette,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-i',
    palette,
    '-lavfi',
    `${vf}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
    '-loop',
    '0',
    join(DIR, `overview.${lang}.gif`),
  ]);
  rmSync(frames, { recursive: true, force: true });
  console.log(`overview.${lang}.mp4 / overview.${lang}.gif`);
}
await browser.close();
