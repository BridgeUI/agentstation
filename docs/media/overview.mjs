// README の先頭に置く動作概要のアニメーション（SVG）を作る。英語版と日本語版。README には render-video.mjs で書き出した GIF を載せる。
//   node docs/media/overview.mjs   → docs/media/overview.en.svg / overview.ja.svg
// 外部のツールは使わない（CSS の keyframes だけ）。GitHub の README の <img> でそのまま再生される。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const T = 18; // 1 周の秒数

const TEXT = {
  en: {
    font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    captions: [
      'Each environment runs an agent that reports to Cloudflare every 60 s (outbound only)',
      'Open the dashboard on your phone to see every environment (Cloudflare Access login)',
      'When Remote Control drops, the dashboard turns red and Slack is notified',
      'Tap to fix: the command waits in D1 and the agent picks it up on its next report',
    ],
    overview: 'Overview',
    connected: 'Connected',
    lost: 'Offline',
    restarting: 'Restarting',
    button: 'Restart Remote Control',
    queued: 'rc_restart → vm1',
    slack: 'vm1: Remote Control disconnected',
    outbound: 'HTTPS, outbound only',
    agent: 'agent',
    rc: 'Claude Code RC',
    you: 'You',
    queue: 'command queue',
  },
  ja: {
    font: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif',
    captions: [
      '各環境のエージェントが 60 秒ごとに Cloudflare へ報告（Mac からは外向きの接続だけ）',
      'スマホでダッシュボードを開けば、全環境の状態が分かる（Cloudflare Access でログイン）',
      'Remote Control が切れると、画面が赤くなり Slack に通知が届く',
      'ボタンで復旧：指示は D1 に積まれ、エージェントが次の報告のときに受け取って実行',
    ],
    overview: '一覧',
    connected: '接続中',
    lost: '切断',
    restarting: '再起動中',
    button: 'Remote Control を立て直す',
    queued: 'rc_restart → vm1',
    slack: 'vm1 の Remote Control が切断',
    outbound: 'HTTPS・外向きだけ',
    agent: 'エージェント',
    rc: 'Claude Code RC',
    you: 'あなた',
    queue: '指示の待ち行列',
  },
};

// シーンの区切り（秒）
const SCENES = [
  [0, 4.5],
  [4.5, 8],
  [8, 11.5],
  [11.5, T],
];

const pct = (t) => `${Math.max(0, Math.min(100, (t / T) * 100)).toFixed(3)}%`;
let css = '';
let uid = 0;

/** points: [[秒, { css プロパティ: 値 }], ...]。間は補間、同じ値を続ければ保持 */
function anim(points, easing = 'linear') {
  const name = `a${uid++}`;
  const frames = points.map(([t, props]) => {
    const body = Object.entries(props)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    return `${pct(t)}{${body}}`;
  });
  css += `@keyframes ${name}{${frames.join('')}}\n`;
  return `animation:${name} ${T}s ${easing} infinite`;
}

/** [開始, 終了] の間だけ見せる（前後 0.25 秒でフェード） */
function visible(from, to, fade = 0.25) {
  const pts = [[0, { opacity: from <= 0 ? 1 : 0 }]];
  if (from > 0) pts.push([from - fade, { opacity: 0 }], [from, { opacity: 1 }]);
  if (to < T) pts.push([to, { opacity: 1 }], [to + fade, { opacity: 0 }]);
  pts.push([T, { opacity: to >= T ? 1 : 0 }]);
  return anim(pts);
}

/** 点が (x1,y1) → (x2,y2) を移動する。trips: [[開始秒, 所要秒], ...] */
function dot(x1, y1, x2, y2, trips, color) {
  const pts = [[0, { opacity: 0, transform: `translate(${x1}px,${y1}px)` }]];
  for (const [t0, d] of trips) {
    pts.push([t0 - 0.01, { opacity: 0, transform: `translate(${x1}px,${y1}px)` }]);
    pts.push([t0, { opacity: 1, transform: `translate(${x1}px,${y1}px)` }]);
    pts.push([t0 + d, { opacity: 1, transform: `translate(${x2}px,${y2}px)` }]);
    pts.push([t0 + d + 0.01, { opacity: 0, transform: `translate(${x2}px,${y2}px)` }]);
  }
  pts.push([T, { opacity: 0, transform: `translate(${x1}px,${y1}px)` }]);
  return `<g style="${anim(pts, 'ease-in-out')}"><circle r="6" fill="${color}"/></g>`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(lang) {
  css = '';
  uid = 0;
  const L = TEXT[lang];
  const G = '#30a46c'; // 緑
  const R = '#e5484d'; // 赤
  const A = '#f5a524'; // 黄
  const INK = '#1d1d1f';
  const MUTED = '#6e6e73';
  const LINE = '#d2d2d7';

  // vm1 の状態の移り変わり（Mac 側と画面側）
  const macLost = 8.3;
  const phoneLost = 8.9;
  const restartAt = 14.6;
  const macBack = 15.4;
  const phoneBack = 16.1;

  const captions = L.captions
    .map(
      (c, i) =>
        `<text x="480" y="52" text-anchor="middle" font-size="19" font-weight="600" fill="${INK}" style="${visible(
          SCENES[i][0] === 0 ? 0 : SCENES[i][0],
          SCENES[i][1] >= T ? T : SCENES[i][1] - 0.25,
        )}">${esc(c)}</text>`,
    )
    .join('');
  const steps = SCENES.map(
    (s, i) =>
      `<circle cx="${450 + i * 20}" cy="78" r="4" fill="${INK}" style="${anim([
        [0, { opacity: s[0] === 0 ? 1 : 0.15 }],
        ...(s[0] > 0
          ? [
              [s[0] - 0.01, { opacity: 0.15 }],
              [s[0], { opacity: 1 }],
            ]
          : []),
        ...(s[1] < T
          ? [
              [s[1] - 0.01, { opacity: 1 }],
              [s[1], { opacity: 0.15 }],
            ]
          : []),
        [T, { opacity: s[1] >= T ? 1 : 0.15 }],
      ])}"/>`,
  ).join('');

  // ---- スマホ（左） ----
  const phoneRows = [
    { y: 214, name: 'Taro', env: 'host' },
    { y: 262, name: 'Hanako', env: 'vm1' },
    { y: 310, name: 'Jiro', env: 'vm2' },
  ]
    .map((r) => {
      const isVm1 = r.env === 'vm1';
      const status = isVm1
        ? `<text x="232" y="${r.y + 5}" text-anchor="end" font-size="12" fill="${G}" style="${visible(0, phoneLost - 0.25)}">${L.connected}</text>
           <text x="232" y="${r.y + 5}" text-anchor="end" font-size="12" font-weight="600" fill="${R}" style="${visible(phoneLost, phoneBack - 0.25)}">${L.lost}</text>
           <text x="232" y="${r.y + 5}" text-anchor="end" font-size="12" fill="${G}" style="${visible(phoneBack, T)}">${L.connected}</text>`
        : `<text x="232" y="${r.y + 5}" text-anchor="end" font-size="12" fill="${G}">${L.connected}</text>`;
      const dotColor = isVm1
        ? `style="${anim([
            [0, { fill: G }],
            [phoneLost - 0.01, { fill: G }],
            [phoneLost, { fill: R }],
            [phoneBack - 0.01, { fill: R }],
            [phoneBack, { fill: G }],
            [T, { fill: G }],
          ])}"`
        : `fill="${G}"`;
      const rowBg = isVm1
        ? `<rect x="84" y="${r.y - 20}" width="164" height="40" rx="8" fill="${R}" style="${anim([
            [0, { opacity: 0 }],
            [phoneLost - 0.01, { opacity: 0 }],
            [phoneLost, { opacity: 0.08 }],
            [phoneBack - 0.01, { opacity: 0.08 }],
            [phoneBack, { opacity: 0 }],
            [T, { opacity: 0 }],
          ])}"/>`
        : '';
      return `${rowBg}
        <circle cx="100" cy="${r.y}" r="11" fill="#f2f2f4"/><text x="100" y="${r.y + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${INK}">${r.name[0]}</text>
        <text x="118" y="${r.y - 2}" font-size="13" font-weight="600" fill="${INK}">${r.name}</text>
        <text x="118" y="${r.y + 13}" font-size="10" fill="${MUTED}">${r.env}</text>
        <circle cx="${isVm1 ? 232 - (lang === 'ja' ? 46 : 70) : 232 - (lang === 'ja' ? 46 : 70)}" cy="${r.y + 1}" r="4" ${dotColor}/>
        ${status}`;
    })
    .join('');

  const phone = `
    <g>
      <text x="166" y="128" text-anchor="middle" font-size="12" fill="${MUTED}">${L.you}</text>
      <rect x="72" y="138" width="188" height="356" rx="30" fill="#fff" stroke="${INK}" stroke-width="3"/>
      <rect x="136" y="148" width="60" height="8" rx="4" fill="${INK}" opacity=".85"/>
      <text x="90" y="182" font-size="17" font-weight="700" fill="${INK}">${L.overview}</text>
      ${phoneRows}
      <g style="${visible(11.8, 13.2)}">
        <rect x="88" y="380" width="156" height="34" rx="9" fill="${INK}"/>
        <text x="166" y="402" text-anchor="middle" font-size="${lang === 'ja' ? 11.5 : 11.5}" font-weight="600" fill="#fff">${L.button}</text>
        <circle cx="200" cy="397" r="8" fill="#fff" style="${anim([
          [0, { opacity: 0, transform: 'scale(1)' }],
          [12.3, { opacity: 0 }],
          [12.35, { opacity: 0.6 }],
          [12.9, { opacity: 0 }],
          [T, { opacity: 0 }],
        ])}"/>
      </g>
    </g>`;

  // ---- Cloudflare（中央） ----
  const cloud = `
    <g>
      <rect x="350" y="150" width="250" height="300" rx="14" fill="#fff" stroke="${LINE}"/>
      <text x="475" y="180" text-anchor="middle" font-size="14" font-weight="700" fill="#f38020">Cloudflare</text>
      <rect x="378" y="198" width="194" height="70" rx="10" fill="#f5f5f7" stroke="${LINE}"/>
      <text x="475" y="226" text-anchor="middle" font-size="14" font-weight="600" fill="${INK}">Worker</text>
      <text x="475" y="248" text-anchor="middle" font-size="11" fill="${MUTED}">Access · API · Cron</text>
      <rect x="378" y="284" width="194" height="86" rx="10" fill="#f5f5f7" stroke="${LINE}"/>
      <text x="475" y="308" text-anchor="middle" font-size="14" font-weight="600" fill="${INK}">D1</text>
      <text x="475" y="326" text-anchor="middle" font-size="10.5" fill="${MUTED}">${L.queue}</text>
      <g style="${visible(13.0, 14.2)}">
        <rect x="400" y="336" width="150" height="24" rx="6" fill="#fff" stroke="${INK}"/>
        <text x="475" y="352" text-anchor="middle" font-size="11" font-family="ui-monospace, Menlo, monospace" fill="${INK}">${L.queued}</text>
      </g>
      <g style="${visible(9.4, 11.4)}">
        <rect x="372" y="388" width="206" height="44" rx="10" fill="#4a154b"/>
        <text x="390" y="408" font-size="11" font-weight="700" fill="#fff">Slack</text>
        <text x="390" y="424" font-size="11" fill="#fff">${L.slack}</text>
      </g>
    </g>`;

  // ---- Mac mini（右） ----
  const envBox = (y, name, env, isVm1) => {
    const pill = isVm1
      ? `<g>
          <rect x="784" y="${y + 30}" width="${lang === 'ja' ? 92 : 100}" height="20" rx="10" style="${anim(
            [
              [0, { fill: G }],
              [macLost - 0.01, { fill: G }],
              [macLost, { fill: R }],
              [restartAt - 0.01, { fill: R }],
              [restartAt, { fill: A }],
              [macBack - 0.01, { fill: A }],
              [macBack, { fill: G }],
              [T, { fill: G }],
            ],
          )}"/>
          <text x="${784 + (lang === 'ja' ? 46 : 50)}" y="${y + 44}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff" style="${visible(0, macLost - 0.2, 0.1)}">${L.connected}</text>
          <text x="${784 + (lang === 'ja' ? 46 : 50)}" y="${y + 44}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff" style="${visible(macLost, restartAt - 0.1, 0.1)}">${L.lost}</text>
          <text x="${784 + (lang === 'ja' ? 46 : 50)}" y="${y + 44}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff" style="${visible(restartAt, macBack - 0.1, 0.1)}">${L.restarting}</text>
          <text x="${784 + (lang === 'ja' ? 46 : 50)}" y="${y + 44}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff" style="${visible(macBack, T, 0.1)}">${L.connected}</text>
        </g>`
      : `<rect x="784" y="${y + 30}" width="${lang === 'ja' ? 92 : 100}" height="20" rx="10" fill="${G}"/>
         <text x="${784 + (lang === 'ja' ? 46 : 50)}" y="${y + 44}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff">${L.connected}</text>`;
    return `<rect x="676" y="${y}" width="216" height="66" rx="10" fill="#f5f5f7" stroke="${LINE}"/>
      <text x="690" y="${y + 22}" font-size="13" font-weight="700" fill="${INK}">${name}</text>
      <text x="${name.length * 8 + 698}" y="${y + 22}" font-size="11" fill="${MUTED}">${env}</text>
      <rect x="690" y="${y + 30}" width="${lang === 'ja' ? 86 : 60}" height="20" rx="10" fill="#fff" stroke="${LINE}"/>
      <text x="${690 + (lang === 'ja' ? 43 : 30)}" y="${y + 44}" text-anchor="middle" font-size="10.5" fill="${INK}">${L.agent}</text>
      ${pill}`;
  };
  const mac = `
    <g>
      <rect x="660" y="150" width="248" height="300" rx="14" fill="#fff" stroke="${LINE}"/>
      <text x="784" y="180" text-anchor="middle" font-size="14" font-weight="700" fill="${INK}">Mac mini</text>
      ${envBox(196, 'Taro', 'host', false)}
      ${envBox(278, 'Hanako', 'vm1 · Tart', true)}
      ${envBox(360, 'Jiro', 'vm2 · Tart', false)}
      <text x="784" y="${468}" text-anchor="middle" font-size="10.5" fill="${MUTED}">${L.rc}</text>
    </g>`;

  // ---- 線と点 ----
  const links = `
    <line x1="260" y1="300" x2="350" y2="300" stroke="${LINE}" stroke-width="2" stroke-dasharray="5 5"/>
    <line x1="600" y1="300" x2="660" y2="300" stroke="${LINE}" stroke-width="2" stroke-dasharray="5 5"/>
    <text x="630" y="500" text-anchor="middle" font-size="11" fill="${MUTED}">⟵ ${L.outbound}</text>`;
  const hostY = 229;
  const vm1Y = 311;
  const vm2Y = 393;
  const dots = [
    // 報告（右 → 中央）。シーン 1 は 3 環境とも、そのあとも時々
    dot(
      676,
      hostY,
      572,
      233,
      [
        [0.6, 0.9],
        [2.6, 0.9],
        [6.0, 0.9],
        [10.2, 0.9],
      ],
      G,
    ),
    dot(
      676,
      vm1Y,
      572,
      233,
      [
        [0.9, 0.9],
        [2.9, 0.9],
        [6.3, 0.9],
      ],
      G,
    ),
    dot(676, vm1Y, 572, 233, [[macLost, 0.6]], R),
    dot(676, vm1Y, 572, 233, [[13.4, 0.6]], R),
    dot(676, vm1Y, 572, 233, [[macBack + 0.1, 0.6]], G),
    dot(
      676,
      vm2Y,
      572,
      233,
      [
        [1.2, 0.9],
        [3.2, 0.9],
        [6.6, 0.9],
      ],
      G,
    ),
    // 画面が状態を取りにいく（中央 → 左）
    dot(
      378,
      233,
      248,
      262,
      [
        [5.0, 0.7],
        [phoneLost - 0.6, 0.55],
        [phoneBack - 0.55, 0.5],
      ],
      '#0a84ff',
    ),
    // ボタン → 待ち行列（左 → 中央）
    dot(244, 397, 400, 348, [[12.4, 0.6]], INK),
    // 待ち行列 → vm1 のエージェント（次の報告の応答で受け取る）
    dot(550, 348, 690, vm1Y + 8, [[14.0, 0.6]], INK),
  ].join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" font-family='${L.font}' role="img" aria-label="${esc(L.captions.join(' / '))}">
<style>
${css}text{dominant-baseline:auto}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect width="960" height="540" fill="#f5f5f7"/>
${captions}
${steps}
${links}
${cloud}
${mac}
${phone}
${dots}
</svg>
`;
  return svg;
}

for (const lang of ['en', 'ja']) {
  writeFileSync(join(OUT, `overview.${lang}.svg`), build(lang));
  console.log(`docs/media/overview.${lang}.svg`);
}
