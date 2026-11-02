// 画面（ui/main.ts）のビルド。ビルド id を app.js に埋め込み、同じ id を public/version.json に書く。
// 画面は起動時と前面に戻ったときに version.json を見て、自分の id と違えば再読み込みする（古い app を抱えたまま動き続けない）。
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let hash = 'nogit';
try {
  hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* git が無くても動く */
}
const id = `${hash}-${Date.now().toString(36)}`;

await build({
  entryPoints: ['ui/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/app.js',
  define: { __BUILD_ID__: JSON.stringify(id) },
  logLevel: 'info',
});
writeFileSync('public/version.json', JSON.stringify({ build: id }) + '\n');
