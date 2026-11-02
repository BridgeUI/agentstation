// ../shared/src/env.ts
var ENVS = ["host", "vm1", "vm2"];
function isEnv(x) {
  return typeof x === "string" && ENVS.includes(x);
}

// ../shared/src/commands.ts
var CLOUD_EXECUTOR = "cloud";
var TEN_MIN = 10 * 60 * 1e3;
var COMMAND_SPECS = {
  rc_restart: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  session_restore: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  rc_start_dir: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  rc_stop_dir: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  rc_mkdir: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  rc_permission_set: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  claude_permission_set: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  claude_update: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  codex_restart: {
    targets: ["host", "vm1", "vm2"],
    executor: "self",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  vm_restart: {
    targets: ["vm1", "vm2"],
    executor: "host",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  vm_stop: {
    targets: ["vm1", "vm2"],
    executor: "host",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  vm_start: {
    targets: ["vm1", "vm2"],
    executor: "host",
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN
  },
  host_restart: {
    targets: ["host"],
    executor: "host",
    confirm: 2,
    ownerOnly: true,
    ttlMs: TEN_MIN,
    graceMs: 60 * 1e3
  },
  // スマートプラグで Mac の電源を切って入れる（docs/spec.md 6.1）。Worker が SwitchBot のクラウドを呼ぶ。
  // host の報告が 10 分以上途絶えているときだけ受け付ける（サーバーで判定）
  host_power_cycle: {
    targets: ["host"],
    executor: CLOUD_EXECUTOR,
    confirm: 2,
    ownerOnly: true,
    ttlMs: TEN_MIN,
    graceMs: 60 * 1e3
  }
};
var RC_DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
function isRcDirName(x) {
  return typeof x === "string" && RC_DIR_NAME_RE.test(x) && x !== "." && x !== "..";
}

// ../shared/src/heartbeat.ts
function isHostHeartbeat(h) {
  return h.env === "host";
}

// ../shared/src/members.ts
function canOperate(id, env) {
  return id.role === "owner" || id.envs.includes(env);
}

// ../shared/src/api.ts
var LIVENESS_DELAYED_MS = 3 * 60 * 1e3;
var LIVENESS_UNRESPONSIVE_MS = 10 * 60 * 1e3;
var POLL_IDLE_MS = 60 * 1e3;
var POLL_FAST_MS = 5 * 1e3;
var VIEW_ACTIVE_WINDOW_MS = 90 * 1e3;

// ../shared/src/setup.ts
var SETUP_CHECK_KEYS = [
  "power.sleep",
  "power.disksleep",
  "power.autorestartatconnect",
  "power.powernap",
  "security.filevault",
  "login.autologin",
  "update.macos_auto_install",
  "update.appstore_auto",
  "sharing.ssh",
  "sharing.vnc",
  "sharing.smb_workspace",
  "network.ethernet",
  "system.timezone",
  "claude.logged_in",
  "claude.autoupdater_off",
  "claude.default_bypass",
  "claude.workdir",
  "launchd.claude_rc",
  "launchd.codex",
  "launchd.vm1",
  "launchd.vm2",
  "cloudflared.running",
  "sudoers.shutdown",
  "timemachine.tart_excluded",
  "disk.free",
  "user.name"
];
var ALL = ["host", "vm1", "vm2"];
var HOST = ["host"];
var SETUP_CHECK_SPECS = {
  "power.sleep": { label: "\u30B9\u30EA\u30FC\u30D7\u7121\u52B9", manual: false, how: "sudo pmset -a sleep 0", envs: ALL },
  "power.disksleep": {
    label: "\u30C7\u30A3\u30B9\u30AF\u306E\u30B9\u30EA\u30FC\u30D7\u7121\u52B9",
    manual: false,
    how: "sudo pmset -a disksleep 0",
    envs: ALL
  },
  // 「停電後に自動的に起動」（autorestart）ではなく「常に」（autorestartatconnect）。
  // autorestart は電源が切れる前に動いていたときだけ戻るので、意図してシャットダウンしたあとにスマートプラグで
  // 電源を入れ直しても起動しない（2026-11-01 オーナーの指摘で変更。docs/spec.md 3.2）
  "power.autorestartatconnect": {
    label: "\u96FB\u6E90\u304C\u5165\u3063\u305F\u3089\u5E38\u306B\u81EA\u52D5\u7684\u306B\u8D77\u52D5",
    manual: false,
    how: "sudo pmset -a autorestartatconnect 1\uFF08\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u30A8\u30CD\u30EB\u30AE\u30FC \u203A \u81EA\u52D5\u7684\u306B\u8D77\u52D5\uFF1A\u5E38\u306B\uFF09",
    envs: HOST
  },
  "power.powernap": {
    label: "Power Nap \u30AA\u30D5",
    manual: false,
    how: "sudo pmset -a powernap 0",
    envs: ALL
  },
  "security.filevault": {
    label: "FileVault \u30AA\u30D5",
    manual: true,
    how: "\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u30D7\u30E9\u30A4\u30D0\u30B7\u30FC\u3068\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3 \u203A FileVault",
    envs: ALL
  },
  "login.autologin": {
    label: "\u81EA\u52D5\u30ED\u30B0\u30A4\u30F3",
    manual: true,
    how: "\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u30E6\u30FC\u30B6\u3068\u30B0\u30EB\u30FC\u30D7 \u203A \u81EA\u52D5\u30ED\u30B0\u30A4\u30F3",
    envs: ALL
  },
  "update.macos_auto_install": {
    label: "macOS \u81EA\u52D5\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB \u30AA\u30D5",
    manual: false,
    how: "defaults write com.apple.SoftwareUpdate \u2026\uFF08setup-mac.md\uFF09",
    envs: ALL
  },
  "update.appstore_auto": {
    label: "App Store \u81EA\u52D5\u66F4\u65B0 \u30AA\u30D5",
    manual: false,
    how: "sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false\uFF08\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306F\u30B7\u30B9\u30C6\u30E0\u5074\u306E /Library/Preferences \u3092\u898B\u308B\uFF09",
    envs: ALL
  },
  "sharing.ssh": {
    label: "\u30EA\u30E2\u30FC\u30C8\u30ED\u30B0\u30A4\u30F3\uFF08SSH\uFF09\u30AA\u30F3",
    manual: true,
    how: "\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u4E00\u822C \u203A \u5171\u6709 \u203A \u30EA\u30E2\u30FC\u30C8\u30ED\u30B0\u30A4\u30F3",
    envs: ALL
  },
  "sharing.vnc": {
    label: "\u753B\u9762\u5171\u6709\uFF08VNC\uFF09\u30AA\u30F3",
    manual: true,
    how: "\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u4E00\u822C \u203A \u5171\u6709 \u203A \u753B\u9762\u5171\u6709\uFF08VNC \u30D1\u30B9\u30EF\u30FC\u30C9\u3082\uFF09",
    envs: ALL
  },
  // iPhone の「ファイル」アプリ用（smb://<内部IP>/workspace。cloudflare/warp/setup.md 6-5）。
  // 445 が開いている、`workspace` の共有がある（ゲスト不可）、利用者に SMB-NT ハッシュがある、の 3 つが揃って ok
  "sharing.smb_workspace": {
    label: "\u30D5\u30A1\u30A4\u30EB\u5171\u6709\uFF08SMB\uFF09\u3067 workspace \u3092\u516C\u958B",
    manual: true,
    how: "sudo bash mac/scripts/smb-workspace.sh\uFF08\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u805E\u304B\u308C\u308B\uFF09",
    envs: ALL
  },
  "network.ethernet": {
    label: "\u6709\u7DDA LAN \u3067\u63A5\u7D9A",
    manual: true,
    how: "Ethernet \u3092\u3064\u306A\u304E\u3001Wi\u2011Fi \u3092\u512A\u5148\u306B\u3057\u306A\u3044",
    envs: HOST
  },
  "system.timezone": {
    label: "\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3 Asia/Tokyo",
    manual: true,
    how: "\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A \u203A \u4E00\u822C \u203A \u65E5\u4ED8\u3068\u6642\u523B",
    envs: ALL
  },
  "claude.logged_in": {
    label: "Claude Code \u306B\u30ED\u30B0\u30A4\u30F3\u6E08\u307F",
    manual: true,
    how: "claude auth login\uFF08\u305D\u306E\u74B0\u5883\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\uFF09",
    envs: ALL
  },
  "claude.autoupdater_off": {
    label: "Claude \u306E\u81EA\u52D5\u66F4\u65B0 \u30AA\u30D5",
    manual: false,
    how: "~/.claude/settings.json \u306B DISABLE_AUTOUPDATER=1",
    envs: ALL
  },
  "claude.default_bypass": {
    label: "Claude Code \u306E\u65E2\u5B9A\u3067\u6A29\u9650\u306E\u78BA\u8A8D\u3092\u7701\u304F",
    manual: false,
    how: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u306E\u300C\u64CD\u4F5C\u300D\u3067\u30AA\u30F3\uFF08~/.claude/settings.json \u306E permissions.defaultMode \u3068 skipDangerousModePermissionPrompt\uFF09",
    envs: ALL
  },
  "claude.workdir": {
    label: "\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u304C\u9069\u5207",
    manual: true,
    how: "Desktop\u30FBDocuments\u30FBDownloads \u4EE5\u5916\uFF08\u4F8B: ~/workspace\uFF09\u306B\u4F5C\u308A\u3001\u4E00\u5EA6 claude \u3092\u8D77\u52D5\u3057\u3066\u4FE1\u983C\u3059\u308B",
    envs: ALL
  },
  "launchd.claude_rc": {
    label: "Remote Control \u306E\u5E38\u99D0\uFF08launchd\uFF09",
    manual: false,
    how: "launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/co.bridgeui.agentstation.claude-rc.plist",
    envs: ALL
  },
  "launchd.codex": {
    label: "Codex \u306E\u5E38\u99D0\uFF08ChatGPT \u30A2\u30D7\u30EA or launchd\uFF09",
    manual: false,
    how: "ChatGPT \u30A2\u30D7\u30EA\u3092\u958B\u3044\u3066\u304A\u304F\uFF08\u30ED\u30B0\u30A4\u30F3\u9805\u76EE\u306B\u5165\u308C\u308B\u3068\u518D\u8D77\u52D5\u5F8C\u3082\u958B\u304F\u3002config \u306E codex_app\uFF09\u3002CLI \u306E daemon \u3092\u4F7F\u3046\u306A\u3089 launchd\uFF08verify.md C-5\uFF09",
    envs: ALL
  },
  "launchd.vm1": {
    label: "vm1 \u306E\u81EA\u52D5\u8D77\u52D5\uFF08launchd\uFF09",
    manual: false,
    how: "launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/co.bridgeui.agentstation.tart-vm1.plist",
    envs: HOST
  },
  "launchd.vm2": {
    label: "vm2 \u306E\u81EA\u52D5\u8D77\u52D5\uFF08launchd\uFF09",
    manual: false,
    how: "launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/co.bridgeui.agentstation.tart-vm2.plist",
    envs: HOST
  },
  "cloudflared.running": {
    label: "cloudflared\uFF08Tunnel\uFF09\u304C\u52D5\u4F5C\u4E2D",
    manual: false,
    how: "sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist",
    envs: HOST
  },
  "sudoers.shutdown": {
    label: "\u30DB\u30B9\u30C8\u518D\u8D77\u52D5\u306E sudoers",
    manual: false,
    how: "mac/sudoers.d/agentstation \u3092 /etc/sudoers.d/ \u306B",
    envs: HOST
  },
  "timemachine.tart_excluded": {
    label: "VM \u30A4\u30E1\u30FC\u30B8\u3092 Time Machine \u304B\u3089\u9664\u5916",
    manual: false,
    how: "tmutil addexclusion ~/.tart",
    envs: HOST
  },
  "disk.free": {
    label: "\u30C7\u30A3\u30B9\u30AF\u306E\u7A7A\u304D\uFF0815% \u4EE5\u4E0A\uFF09",
    manual: false,
    how: "\u4E0D\u8981\u306A\u30D5\u30A1\u30A4\u30EB\u3092\u6D88\u3059\u3002VM \u30A4\u30E1\u30FC\u30B8\u306E\u80A5\u5927\u306B\u6CE8\u610F",
    envs: ALL
  },
  "user.name": {
    label: "\u30E6\u30FC\u30B6\u30FC\u540D\u304C\u30E1\u30FC\u30EB\u306E @ \u524D\u3068\u4E00\u81F4",
    manual: true,
    how: "\u30E6\u30FC\u30B6\u30FC\u540D\u3092\u5909\u3048\u308B\u304B\u3001Access \u306E\u30E1\u30FC\u30EB\u3092\u5408\u308F\u305B\u308B",
    envs: ALL
  }
};
function setupKeysFor(env) {
  return SETUP_CHECK_KEYS.filter((k) => SETUP_CHECK_SPECS[k].envs.includes(env));
}
function summarizeSetup(checks) {
  const s = { total: 0, ok: 0, ng: 0, unknown: 0, manualNg: [] };
  for (const c of checks) {
    if (c.status === "skip") continue;
    s.total++;
    if (c.status === "ok") s.ok++;
    else if (c.status === "ng") {
      s.ng++;
      if (SETUP_CHECK_SPECS[c.key].manual) s.manualNg.push(c.key);
    } else s.unknown++;
  }
  return s;
}

// ../shared/src/site.ts
var DEFAULT_SITE = {
  app_name: "agentstation",
  app_short_name: "agentstation",
  machine_name: "Mac",
  login_email_domain: "",
  org_name: "Example",
  org_footer: "Example Inc.",
  domain: "example.com",
  dashboard_host: "workstation.example.com",
  access_team: "example",
  people: {
    host: { name: "Taro", login: "taro" },
    vm1: { name: "Hanako", login: "hanako" },
    vm2: { name: "Jiro", login: "jiro" }
  }
};

// ui/api.ts
var ApiFailure = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    throw new ApiFailure(0, "\u30B5\u30FC\u30D0\u30FC\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093");
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body && typeof body === "object" ? body.error : void 0;
    if (res.status === 401) throw new ApiFailure(401, err ?? "\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059");
    throw new ApiFailure(res.status, err ?? `\u30A8\u30E9\u30FC\uFF08${res.status}\uFF09`);
  }
  return body;
}
var api = {
  me: () => call("/api/me"),
  status: () => call("/api/status"),
  audit: (limit = 50) => call(`/api/audit?limit=${limit}`),
  sessions: (env) => call(`/api/sessions?env=${encodeURIComponent(env)}`),
  createCommand: (req) => call("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req)
  }),
  /** VNC パスワード。押したときだけ取りに行く（docs/spec.md 13章 #16） */
  vncPassword: (env) => call(`/api/vnc-password?env=${encodeURIComponent(env)}`),
  /** Slack のテスト通知（オーナーだけ） */
  notifyTest: () => call("/api/notify/test", { method: "POST" }),
  cancelCommand: (id) => call(`/api/commands/${encodeURIComponent(id)}/cancel`, { method: "POST" })
};

// ui/dom.ts
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var Raw = class extends String {
  constructor(s) {
    super(String(s ?? ""));
  }
};
var raw = (s) => s instanceof Raw ? s : new Raw(s);
function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.valueOf();
      else if (Array.isArray(v))
        out += v.map((x) => x instanceof Raw ? x.valueOf() : esc(x)).join("");
      else out += esc(v);
    }
  });
  return new Raw(out);
}
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} \u304C\u306A\u3044`);
  return el;
}
function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
function show(el, on) {
  el.hidden = !on;
}
function setupExplainButtons() {
  for (const btn of $$("button[data-explain]")) {
    const key = btn.dataset.explain ?? "";
    btn.addEventListener("click", () => {
      const open2 = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", open2 ? "true" : "false");
      const label = btn.querySelector("span");
      if (label) label.textContent = open2 ? "\u8AAC\u660E\u3092\u9589\u3058\u308B" : "\u8AAC\u660E";
      for (const body of $$(`[data-explain-body="${key}"]`)) body.hidden = !open2;
    });
  }
}
function explainOpen(key) {
  const btn = document.querySelector(`button[data-explain="${key}"]`);
  return btn?.getAttribute("aria-expanded") === "true";
}
var ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
var ICON_TERM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
var ICON_SCREEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="1"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';

// ui/format.ts
var TZ = "Asia/Tokyo";
var fmtTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
var fmtDay = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric" });
var fmtYmd = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function ymd(ms) {
  return fmtYmd.format(new Date(ms));
}
function hm(ms) {
  return fmtTime.format(new Date(ms));
}
function dayTime(ms, now) {
  const d = ymd(ms);
  if (d === ymd(now)) return hm(ms);
  if (d === ymd(now - 24 * 60 * 60 * 1e3)) return `\u6628\u65E5 ${hm(ms)}`;
  return `${fmtDay.format(new Date(ms))} ${hm(ms)}`;
}
function dayTimeLong(ms, now) {
  const d = ymd(ms);
  if (d === ymd(now)) return `\u4ECA\u65E5 ${hm(ms)}`;
  if (d === ymd(now - 24 * 60 * 60 * 1e3)) return `\u6628\u65E5 ${hm(ms)}`;
  return `${fmtDay.format(new Date(ms))} ${hm(ms)}`;
}
function ago(ms, now) {
  if (ms === null) return "\u672A\u53D7\u4FE1";
  const s = Math.max(0, Math.round((now - ms) / 1e3));
  if (s < 60) return `${s}\u79D2\u524D`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}\u5206\u524D`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}\u6642\u9593\u524D`;
  return `${Math.floor(h / 24)}\u65E5\u524D`;
}
function minutesSince(ms, now) {
  return Math.max(0, Math.floor((now - ms) / 6e4));
}
function gb(v, digits = 0) {
  if (v === void 0) return "\u2014";
  return `${v.toFixed(digits)}GB`;
}

// ui/dialogs.ts
function dlg() {
  const d = document.getElementById("dlg");
  if (!(d instanceof HTMLDialogElement)) throw new Error("#dlg \u304C\u306A\u3044");
  return d;
}
function open(body) {
  const d = dlg();
  d.innerHTML = body;
  return new Promise((resolve) => {
    const onClose = () => {
      d.removeEventListener("close", onClose);
      resolve(d.returnValue);
      d.returnValue = "";
    };
    d.addEventListener("close", onClose);
    d.showModal();
  });
}
async function confirmDialog(opts) {
  const r = await open(html`
    <form method="dialog">
      <h2>${opts.title}</h2>
      <p>${opts.body}</p>
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button
          type="submit"
          value="ok"
          class="btn ${opts.danger ? "danger" : "primary"}"
          autofocus
        >
          ${opts.okLabel ?? "\u5B9F\u884C"}
        </button>
      </div>
    </form>
  `);
  return r === "ok";
}
async function hostnameDialog(opts) {
  const r = await open(html`
    <form method="dialog">
      <h2>${opts.title}</h2>
      <p class="strong">確認のため、ホスト名 <code>host</code> を入力してください。</p>
      <p>${opts.note}</p>
      <input
        type="text"
        name="confirm"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="host"
        aria-label="ホスト名"
      />
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button type="submit" value="ok" class="btn danger" id="dlg-ok" disabled>
          ${opts.okLabel}
        </button>
      </div>
    </form>
  `);
  return r === "ok";
}
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || t.name !== "confirm") return;
  const ok = t.form?.querySelector("#dlg-ok");
  if (ok) ok.disabled = t.value.trim() !== "host";
});
async function sessionDialog(sessions, now) {
  if (sessions.length === 0) {
    await open(html`
      <form method="dialog">
        <h2>前のセッションを戻す</h2>
        <p>
          戻せるセッションが記録されていません。エージェントが Remote Control
          のセッションを報告すると、ここに出ます。
        </p>
        <div class="actions">
          <button type="submit" value="cancel" class="btn primary">閉じる</button>
        </div>
      </form>
    `);
    return null;
  }
  const items = sessions.map(
    (s, i) => html`
      <label>
        <input type="radio" name="session" value="${s.session_id}" ${i === 0 ? "checked" : ""} />
        <span style="display: flex; flex-direction: column; gap: 2px">
          <span class="title">${s.title ?? "\uFF08\u30BF\u30A4\u30C8\u30EB\u306A\u3057\uFF09"}</span>
          <span class="meta">
            ${s.started_at ? `\u958B\u59CB ${dayTime(s.started_at, now)}` : "\u958B\u59CB\u6642\u523B \u4E0D\u660E"} · ID
            ${s.session_id.slice(0, 8)}
          </span>
        </span>
      </label>
    `
  );
  const d = dlg();
  const r = await open(html`
    <form method="dialog">
      <h2>前のセッションを戻す</h2>
      <p>戻すセッションを選んでください（止まってから約4時間以内のものだけ戻ります）。</p>
      <div class="session-list">${raw(items.join(""))}</div>
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button type="submit" value="ok" class="btn primary">このセッションを戻す</button>
      </div>
    </form>
  `);
  if (r !== "ok") return null;
  const picked = d.querySelector('input[name="session"]:checked');
  return picked?.value ?? null;
}

// ui/people.ts
var STATIC = {
  host: { account: "\u30A2\u30AB\u30A6\u30F3\u30C8A", shade: "p1", fixedIp: "192.168.64.1" },
  vm1: { account: "\u30A2\u30AB\u30A6\u30F3\u30C8B", shade: "p2" },
  vm2: { account: "\u30A2\u30AB\u30A6\u30F3\u30C8C", shade: "p3" }
};
function personOf(env, name, login) {
  return { env, name, login, initial: (name[0] ?? env[0] ?? "?").toUpperCase(), ...STATIC[env] };
}
var PEOPLE = Object.fromEntries(
  ENVS.map((e) => [e, personOf(e, DEFAULT_SITE.people[e].name, DEFAULT_SITE.people[e].login)])
);
var SITE = DEFAULT_SITE;
var OWNER_NAME = PEOPLE.host.name;
function applySite(site) {
  SITE = site;
  for (const e of ENVS) {
    const p = site.people[e];
    PEOPLE[e] = p ? personOf(e, p.name, p.login) : personOf(e, e, e);
  }
  OWNER_NAME = PEOPLE.host.name;
}
function titleOf(env) {
  return `${PEOPLE[env].name} \u306E\u74B0\u5883`;
}
function shortOf(env) {
  return `${PEOPLE[env].name}\uFF08${env}\uFF09`;
}

// ui/judge.ts
function hostLiveness(s) {
  return s.envs.find((e) => e.env === "host")?.liveness ?? "unknown";
}
function hostHeartbeat(s) {
  const hb = s.envs.find((e) => e.env === "host")?.heartbeat ?? null;
  return hb && isHostHeartbeat(hb) ? hb : null;
}
function judge(e, s) {
  const hostLive = hostLiveness(s);
  const who = shortOf(e.env);
  const owner = PEOPLE[e.env].name;
  if (hostLive === "unresponsive" || e.env === "host" && e.liveness === "unresponsive") {
    return { tone: "none", label: "\u5FDC\u7B54\u306A\u3057" };
  }
  if (e.env !== "host") {
    const vm = e.vm_view;
    if (vm?.vm_state === "stopped") return { tone: "none", label: "\u505C\u6B62" };
    if (vm?.vm_state === "starting") return { tone: "none", label: "\u8D77\u52D5\u4E2D" };
    if (e.liveness === "unresponsive" && hostLive === "ok") {
      return {
        tone: "warn",
        label: "\u8981\u78BA\u8A8D\uFF08\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u505C\u6B62\uFF09",
        banner: {
          level: "warn",
          title: `${who}\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304B\u3089\u5831\u544A\u304C\u5C4A\u3044\u3066\u3044\u307E\u305B\u3093`,
          body: "VM \u306F\u52D5\u3044\u3066\u3044\u307E\u3059\u304C\u3001\u4E2D\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u6B62\u307E\u3063\u3066\u3044\u307E\u3059\u3002\u300CVM\u3092\u518D\u8D77\u52D5\u300D\u304B\u3001SSH\u3067\u5165\u3063\u3066\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3092\u518D\u8D77\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        }
      };
    }
  }
  if (e.liveness === "delayed") return { tone: "warn", label: "\u9045\u5EF6" };
  if (e.liveness === "unknown" || !e.heartbeat) return { tone: "none", label: "\u672A\u53D7\u4FE1" };
  if (e.liveness === "unresponsive") return { tone: "none", label: "\u5FDC\u7B54\u306A\u3057" };
  const hb = e.heartbeat;
  if (hb.claude.rc_state === "login_required") {
    return {
      tone: "bad",
      label: "\u8981\u30ED\u30B0\u30A4\u30F3",
      banner: {
        level: "error",
        title: `${who}\u3067\u518D\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059`,
        body: "Claude Code\u306E\u30ED\u30B0\u30A4\u30F3\u304C\u5207\u308C\u3001Remote Control\u306B\u3064\u306A\u304C\u308A\u307E\u305B\u3093\u3002SSH\u3067\u5165\u308A\u3001claude auth login \u3092\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      }
    };
  }
  if (hb.claude.state === "stopped") {
    return {
      tone: "warn",
      label: "\u8981\u78BA\u8A8D",
      banner: {
        level: "warn",
        title: `${who}\u306EClaude Code\u304C\u505C\u6B62\u3057\u3066\u3044\u307E\u3059`,
        body: `launchd\u304C\u81EA\u52D5\u3067\u518D\u8D77\u52D5\u3092\u8A66\u307F\u3066\u3044\u307E\u3059\u3002\u7D9A\u304F\u5834\u5408\u306F${owner} \u306E\u74B0\u5883\u306E\u753B\u9762\u304B\u3089\u300CRemote Control\u3092\u7ACB\u3066\u76F4\u3059\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
      }
    };
  }
  if (hb.claude.rc_state === "reconnecting") return { tone: "warn", label: "\u8981\u78BA\u8A8D" };
  return { tone: "ok", label: "\u6B63\u5E38" };
}
function overall(s) {
  const hostLive = hostLiveness(s);
  if (hostLive === "unresponsive") return { tone: "none", label: "\u5FDC\u7B54\u306A\u3057" };
  if (hostLive === "unknown") return { tone: "none", label: "\u672A\u53D7\u4FE1" };
  const vs = s.envs.map((e) => judge(e, s));
  const issues = vs.filter((v) => v.tone !== "ok");
  if (issues.length === 0) return { tone: "ok", label: "\u3059\u3079\u3066\u6B63\u5E38" };
  const tone = issues.some((v) => v.tone === "bad") ? "bad" : "warn";
  return { tone, label: `${issues.length}\u4EF6\u306E\u554F\u984C` };
}
function banners(s) {
  const out = [];
  const hostLive = hostLiveness(s);
  for (const a of s.alerts) {
    if (a.message.startsWith("Mac") && hostLive === "unresponsive" && s.host_received_at !== null) {
      out.push({
        level: "error",
        title: `${SITE.machine_name}\u304B\u3089${minutesSince(s.host_received_at, s.now)}\u5206\u9593\u5FDC\u7B54\u304C\u3042\u308A\u307E\u305B\u3093`,
        body: outageAdvice(s)
      });
    } else if (hostLive === "unknown" && a.level === "warn" && s.host_received_at === null) {
      out.push({
        level: "warn",
        title: a.message,
        body: "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u307E\u3060\u4E00\u5EA6\u3082\u5831\u544A\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u5404\u30DE\u30B7\u30F3\u3067 launchd \u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u52D5\u3044\u3066\u3044\u308B\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      });
    } else {
      out.push({ level: a.level, title: a.message, body: "" });
    }
  }
  for (const e of s.envs) {
    const v = judge(e, s);
    if (v.banner) out.push(v.banner);
  }
  return out;
}
var PLUG_OFF_LIKE_W = 1;
function outageAdvice(s) {
  const p = s.plug;
  const cycle = "\u300CTaro \u306E\u74B0\u5883 \u203A \u64CD\u4F5C\u300D\u306E\u300C\u96FB\u6E90\u3092\u5165\u308C\u76F4\u3059\u300D\u3067\u5FA9\u65E7\u3067\u304D\u307E\u3059\uFF08\u30AA\u30FC\u30CA\u30FC\u306E\u307F\uFF09\u3002";
  if (!s.plug_enabled || !p) {
    return "SSH\u3067\u5165\u308C\u308B\u304B\u78BA\u8A8D\u3057\u3001\u5165\u308C\u306A\u3051\u308C\u3070\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\u3067\u96FB\u6E90\u3092\u5165\u308C\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
  }
  if (!p.ok) {
    return "\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\u306B\u3082\u5C4A\u304D\u307E\u305B\u3093\u3002\u81EA\u5B85\u306E\u56DE\u7DDA\u304B\u30EB\u30FC\u30BF\u30FC\u304C\u843D\u3061\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u9AD8\u3044\u306E\u3067\u3001\u623B\u308B\u307E\u3067\u5F85\u3063\u3066\u304F\u3060\u3055\u3044\u3002";
  }
  if (p.state === "off")
    return `\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\u304C\u30AA\u30D5\u3067\u3001${SITE.machine_name} \u306B\u96FB\u6E90\u304C\u6765\u3066\u3044\u307E\u305B\u3093\u3002${cycle}`;
  if (p.state === "on" && p.watts !== null && p.watts < PLUG_OFF_LIKE_W) {
    return `\u30D7\u30E9\u30B0\u306F\u30AA\u30F3\u3067\u3059\u304C\u6D88\u8CBB\u96FB\u529B\u304C\u307B\u307C 0 \u3067\u3059\u3002Mac \u304C\u843D\u3061\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002${cycle}`;
  }
  return `\u30D7\u30E9\u30B0\u306F\u30AA\u30F3\u3067\u901A\u96FB\u3057\u3066\u3044\u307E\u3059${p.watts !== null ? `\uFF08${p.watts}W\uFF09` : ""}\u3002SSH\u3067\u5165\u308C\u308B\u304B\u78BA\u8A8D\u3057\u3001\u5165\u308C\u306A\u3051\u308C\u3070${cycle}`;
}
function plugRow(s) {
  const p = s.plug;
  if (!s.plug_enabled) return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u672A\u8A2D\u5B9A", tone: "none", sub: "" };
  if (!p) return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u672A\u53D6\u5F97", tone: "none", sub: "" };
  const when = `${minutesSince(p.checked_at, s.now)}\u5206\u524D\u306B\u78BA\u8A8D`;
  if (!p.ok) return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u5C4A\u304B\u306A\u3044", tone: "warn", sub: when };
  if (p.state === "off") return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u30AA\u30D5", tone: "bad", sub: when };
  if (p.state === "unknown")
    return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u72B6\u614B\u4E0D\u660E", tone: "none", sub: when };
  const w = p.watts === null ? "" : `${p.watts}W \xB7 `;
  const tone = p.watts !== null && p.watts < PLUG_OFF_LIKE_W ? "warn" : "ok";
  return { label: "\u96FB\u6E90\u30D7\u30E9\u30B0", value: "\u30AA\u30F3", tone, sub: `${w}${when}` };
}
var CLAUDE_STATE = {
  running: ["\u7A3C\u50CD\u4E2D", "ok"],
  stopped: ["\u505C\u6B62\u4E2D\u30FB\u518D\u8D77\u52D5\u5F85\u3061", "warn"],
  unknown: ["\u4E0D\u660E", "none"]
};
var RC_STATE = {
  connected: ["\u63A5\u7D9A\u4E2D", "ok"],
  reconnecting: ["\u518D\u63A5\u7D9A\u5F85\u3061", "warn"],
  login_required: ["\u8981\u30ED\u30B0\u30A4\u30F3", "bad"],
  unknown: ["\u4E0D\u660E", "none"]
};
var CODEX_STATE = {
  running: ["\u7A3C\u50CD\u4E2D", "ok"],
  stopped: ["\u505C\u6B62", "none"],
  unknown: ["\u4E0D\u660E", "none"]
};
var VM_STATE = {
  running: ["\u7A3C\u50CD\u4E2D", "ok"],
  starting: ["\u8D77\u52D5\u4E2D", "none"],
  stopped: ["\u505C\u6B62", "none"],
  unknown: ["\u4E0D\u660E", "none"]
};
function rows(e, s) {
  const v = judge(e, s);
  const down = v.label === "\u5FDC\u7B54\u306A\u3057" || v.label === "\u672A\u53D7\u4FE1";
  const hb = down ? null : e.heartbeat;
  const r = (label, pair) => pair ? { label, value: pair[0], tone: pair[1] } : { label, value: "\u4E0D\u660E", tone: "none" };
  const claude = r("Claude Code", hb ? CLAUDE_STATE[hb.claude.state] : null);
  const rc = r("Remote Control", hb ? RC_STATE[hb.claude.rc_state] : null);
  const codex = r("Codex", hb ? CODEX_STATE[hb.codex.state] : null);
  let fourth;
  if (e.env === "host") {
    const live = e.liveness;
    fourth = live === "ok" ? { label: "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8", value: "60\u79D2\u3054\u3068\u306B\u5831\u544A", tone: "ok" } : live === "delayed" ? { label: "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8", value: "\u5831\u544A\u304C\u9045\u308C\u3066\u3044\u308B", tone: "warn" } : { label: "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8", value: live === "unknown" ? "\u672A\u53D7\u4FE1" : "\u505C\u6B62", tone: "none" };
  } else {
    const vm = hostLiveness(s) === "unresponsive" ? null : e.vm_view;
    fourth = r("VM", vm ? VM_STATE[vm.vm_state] : null);
    if (vm && vm.vm_state === "running" && e.liveness === "unresponsive") {
      fourth = { label: "VM", value: "\u7A3C\u50CD\u4E2D\uFF08\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u505C\u6B62\uFF09", tone: "warn" };
    }
  }
  if (e.env !== "host" && e.vm_view && e.vm_view.vm_state !== "running" && !down) {
    return [
      { ...claude, value: "\u2014", tone: "none" },
      { ...rc, value: "\u2014", tone: "none" },
      { ...codex, value: "\u2014", tone: "none" },
      fourth
    ];
  }
  return [claude, rc, codex, fourth];
}
function shares(s) {
  const hb = hostHeartbeat(s);
  const out = {};
  if (!hb || hostLiveness(s) === "unresponsive") {
    for (const e of s.envs) out[e.env] = { cpu: null, mem: null, disk: null };
    return out;
  }
  const h = hb.host;
  const total = {
    cpu: h.cpu_pct ?? null,
    mem: pctOf(h.mem_used_gb, h.mem_total_gb),
    disk: pctOf(h.disk_used_gb, h.disk_total_gb)
  };
  let vmCpu = 0, vmMem = 0, vmDisk = 0;
  for (const e of s.envs) {
    if (e.env === "host") continue;
    const v = e.vm_view;
    const cpu = v?.usage.cpu_pct_of_host ?? null;
    const mem = pctOf(v?.usage.mem_gb, h.mem_total_gb);
    const disk = pctOf(v?.usage.disk_image_gb, h.disk_total_gb);
    out[e.env] = { cpu, mem, disk };
    vmCpu += cpu ?? 0;
    vmMem += mem ?? 0;
    vmDisk += disk ?? 0;
  }
  out.host = {
    cpu: total.cpu === null ? null : Math.max(0, Math.round(total.cpu - vmCpu)),
    mem: total.mem === null ? null : Math.max(0, Math.round(total.mem - vmMem)),
    disk: total.disk === null ? null : Math.max(0, Math.round(total.disk - vmDisk))
  };
  return out;
}
function pctOf(used, total) {
  if (used === void 0 || total === void 0 || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round(used / total * 100)));
}
var ACTION_LABEL = {
  rc_restart: "Remote Control\u3092\u7ACB\u3066\u76F4\u3059",
  session_restore: "\u524D\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u623B\u3059",
  rc_start_dir: "\u30D5\u30A9\u30EB\u30C0\u306E Remote Control \u3092\u8D77\u52D5",
  rc_stop_dir: "\u30D5\u30A9\u30EB\u30C0\u306E Remote Control \u3092\u505C\u6B62",
  rc_mkdir: "\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210",
  rc_permission_set: "Remote Control \u306E\u6A29\u9650\u30E2\u30FC\u30C9\u3092\u5909\u66F4",
  claude_permission_set: "Claude Code \u306E\u65E2\u5B9A\u306E\u6A29\u9650\u30E2\u30FC\u30C9\u3092\u5909\u66F4",
  claude_update: "Claude Code\u3092\u66F4\u65B0",
  codex_restart: "Codex\u3092\u518D\u8D77\u52D5",
  vm_restart: "VM\u3092\u518D\u8D77\u52D5",
  vm_stop: "VM\u3092\u505C\u6B62",
  vm_start: "VM\u3092\u8D77\u52D5",
  host_restart: "\u30DB\u30B9\u30C8\u3092\u518D\u8D77\u52D5",
  host_power_cycle: "\u96FB\u6E90\u3092\u5165\u308C\u76F4\u3059\uFF08\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\uFF09"
};
var LEGACY_ACTION_LABEL = {
  rc_trust_dir: "\u30D5\u30A9\u30EB\u30C0\u3092\u4FE1\u983C\u3057\u3066 Remote Control \u3092\u8D77\u52D5"
};
function actionLabel(a) {
  if (!a) return "\u2014";
  return ACTION_LABEL[a] ?? LEGACY_ACTION_LABEL[a] ?? a;
}

// ui/commands.ts
var BASE_OPS = [
  {
    action: "rc_restart",
    name: "Remote Control\u3092\u7ACB\u3066\u76F4\u3059",
    desc: "claude remote-control \u3092\u6B62\u3081\u3066\u3001\u540C\u3058\u30D5\u30A9\u30EB\u30C0\u3067\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059\u3002\u6B62\u307E\u3063\u3066\u304B\u3089\u7D044\u6642\u9593\u4EE5\u5185\u306A\u3089\u3001\u524D\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3082\u623B\u308A\u307E\u3059\u3002",
    button: "\u7ACB\u3066\u76F4\u3059",
    confirmBody: "Remote Control \u3092\u6B62\u3081\u3066\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059\u3002\u9032\u884C\u4E2D\u306E\u4F1A\u8A71\u306F\u4E00\u5EA6\u5207\u308C\u307E\u3059\u3002"
  },
  {
    action: "session_restore",
    name: "\u524D\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u623B\u3059",
    desc: "\u8A18\u9332\u3057\u3066\u304A\u3044\u305F\u30BB\u30C3\u30B7\u30E7\u30F3ID\u3092\u9078\u3093\u3067\u3001\u305D\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3060\u3051\u3092\u623B\u3057\u307E\u3059\uFF08\u6B62\u307E\u3063\u3066\u304B\u3089\u7D044\u6642\u9593\u4EE5\u5185\uFF09\u3002",
    button: "\u9078\u3076",
    confirmBody: ""
  },
  {
    action: "claude_update",
    name: "Claude Code\u3092\u66F4\u65B0",
    desc: "claude update \u3092\u5B9F\u884C\u3057\u3001Remote Control\u3092\u7ACB\u3066\u76F4\u3057\u3066\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002\u666E\u6BB5\u306F\u6BCE\u66694\u6642\u306E\u591C\u9593\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9\u3067\u81EA\u52D5\u3067\u884C\u3044\u307E\u3059\u3002",
    button: "\u66F4\u65B0",
    confirmBody: "claude update \u3092\u5B9F\u884C\u3057\u3001Remote Control \u3092\u7ACB\u3066\u76F4\u3057\u307E\u3059\u3002\u6570\u5206\u304B\u304B\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"
  },
  {
    action: "codex_restart",
    name: "Codex\u3092\u518D\u8D77\u52D5",
    desc: "\u5E38\u99D0\u3067\u304D\u308B\u69CB\u6210\u306E\u5834\u5408\u306E\u307F\u6709\u52B9\u3067\u3059\u3002\u78BA\u8A8D\u306F1\u56DE\u3067\u3059\u3002",
    button: "\u518D\u8D77\u52D5",
    confirmBody: "Codex \u306E\u5E38\u99D0\u3092\u518D\u8D77\u52D5\u3057\u307E\u3059\u3002"
  }
];
var HOST_OPS = [
  {
    action: "host_restart",
    name: "\u30DB\u30B9\u30C8\u3092\u518D\u8D77\u52D5",
    desc: "\u30AA\u30FC\u30CA\u30FC\u306E\u307F\u3002VM\u3092\u6B62\u3081\u3066\u304B\u3089\u518D\u8D77\u52D5\u3057\u307E\u3059\u3002\u30DB\u30B9\u30C8\u540D\u306E\u5165\u529B\u3068\u30011\u5206\u9593\u306E\u53D6\u308A\u6D88\u3057\u7336\u4E88\u304C\u3042\u308A\u307E\u3059\u3002",
    button: "\u518D\u8D77\u52D5\u2026",
    danger: true,
    confirmBody: `${SITE.machine_name} \u672C\u4F53\u3092\u518D\u8D77\u52D5\u3057\u307E\u3059\u3002VM \u3082\u6B62\u307E\u308A\u3001\u5168\u54E1\u306E Claude Code \u304C\u6570\u5206\u9593\u4F7F\u3048\u306A\u304F\u306A\u308A\u307E\u3059\u3002\u6B21\u306E\u753B\u9762\u3067\u30DB\u30B9\u30C8\u540D\u3092\u5165\u529B\u3057\u307E\u3059\u3002`
  },
  {
    action: "host_power_cycle",
    name: "\u96FB\u6E90\u3092\u5165\u308C\u76F4\u3059\uFF08\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\uFF09",
    desc: `\u30AA\u30FC\u30CA\u30FC\u306E\u307F\u3002\u6700\u5F8C\u306E\u624B\u6BB5\u3067\u3059\u3002${SITE.machine_name} \u306E\u96FB\u6E90\u30B1\u30FC\u30D6\u30EB\u306B\u631F\u3093\u3060 SwitchBot \u306E\u30D7\u30E9\u30B0\u3092\u30AA\u30D5\u306B\u3057\u3001\u7D04 1 \u5206\u5F8C\u306B\u30AA\u30F3\u306B\u3057\u307E\u3059\u3002\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3082 SSH \u3082\u52B9\u304B\u306A\u3044\u3068\u304D\u3060\u3051\u4F7F\u3048\u307E\u3059\uFF08\u5831\u544A\u304C 10 \u5206\u4EE5\u4E0A\u9014\u7D76\u3048\u3066\u3044\u308B\u3068\u304D\u3060\u3051\u53D7\u3051\u4ED8\u3051\u307E\u3059\uFF09\u3002\u5F37\u5236\u96FB\u6E90\u65AD\u306A\u306E\u3067\u3001\u30C7\u30A3\u30B9\u30AF\u3084\u66F8\u304D\u304B\u3051\u306E\u30D5\u30A1\u30A4\u30EB\u304C\u58CA\u308C\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002`,
    button: "\u5165\u308C\u76F4\u3059\u2026",
    danger: true,
    confirmBody: `${SITE.machine_name} \u306E\u96FB\u6E90\u3092\u5F37\u5236\u7684\u306B\u5207\u3063\u3066\u5165\u308C\u76F4\u3057\u307E\u3059\u3002\u4FDD\u5B58\u3057\u3066\u3044\u306A\u3044\u4F5C\u696D\u306F\u5931\u308F\u308C\u3001VM \u306E\u30A4\u30E1\u30FC\u30B8\u304C\u58CA\u308C\u308B\u3053\u3068\u3082\u3042\u308A\u307E\u3059\u3002\u623B\u308B\u307E\u3067 3\u301C5 \u5206\u304B\u304B\u308A\u307E\u3059\u3002\u6B21\u306E\u753B\u9762\u3067\u30DB\u30B9\u30C8\u540D\u3092\u5165\u529B\u3057\u307E\u3059\u3002`
  }
];
var VM_OPS = [
  {
    action: "vm_restart",
    name: "VM\u3092\u518D\u8D77\u52D5",
    desc: "tart stop \u306E\u3042\u3068\u3001launchd \u304C\u81EA\u52D5\u3067\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059\u3002",
    button: "\u518D\u8D77\u52D5",
    confirmBody: "VM \u3092\u505C\u6B62\u3057\u3001launchd \u306B\u8D77\u52D5\u3057\u76F4\u3055\u305B\u307E\u3059\u3002\u623B\u308B\u307E\u3067 2 \u5206\u307B\u3069\u304B\u304B\u308A\u307E\u3059\u3002"
  },
  {
    action: "vm_stop",
    name: "VM\u3092\u505C\u6B62",
    desc: "\u81EA\u52D5\u8D77\u52D5\u3082\u6B62\u3081\u307E\u3059\u3002\u518D\u958B\u306F\u300CVM\u3092\u8D77\u52D5\u300D\u304B\u3089\u884C\u3044\u307E\u3059\u3002",
    button: "\u505C\u6B62",
    confirmBody: "VM \u3092\u505C\u6B62\u3057\u3001\u81EA\u52D5\u8D77\u52D5\u3082\u6B62\u3081\u307E\u3059\u3002\u518D\u958B\u3059\u308B\u306B\u306F\u300CVM\u3092\u8D77\u52D5\u300D\u3092\u62BC\u3057\u307E\u3059\u3002"
  },
  {
    action: "vm_start",
    name: "VM\u3092\u8D77\u52D5",
    desc: "\u505C\u6B62\u4E2D\u306E VM \u3092\u8D77\u52D5\u3057\u3001\u81EA\u52D5\u8D77\u52D5\u3082\u623B\u3057\u307E\u3059\u3002",
    button: "\u8D77\u52D5",
    confirmBody: "VM \u3092\u8D77\u52D5\u3057\u307E\u3059\u3002\u4E2D\u306E Claude Code \u304C\u5831\u544A\u3092\u59CB\u3081\u308B\u307E\u3067 2 \u5206\u307B\u3069\u304B\u304B\u308A\u307E\u3059\u3002"
  }
];
function opsFor(env) {
  return env === "host" ? [...BASE_OPS, ...HOST_OPS] : [...BASE_OPS, ...VM_OPS];
}
function canPress(me, env, action) {
  const spec = COMMAND_SPECS[action];
  if (!spec.targets.includes(env)) return false;
  if (spec.ownerOnly && me.role !== "owner") return false;
  return canOperate(me, env);
}
async function runOp(env, op, serverNow) {
  const who = titleOf(env);
  let args;
  if (op.action === "session_restore") {
    let sessions;
    try {
      sessions = await api.sessions(env);
    } catch (e) {
      return { ok: false, message: msgOf(e) };
    }
    const id = await sessionDialog(sessions, serverNow);
    if (!id) return { ok: false };
    args = { session_id: id };
  } else {
    const ok = await confirmDialog({
      title: `${who}\uFF1A${op.name}`,
      body: op.confirmBody,
      okLabel: op.danger ? "\u6B21\u3078" : op.button,
      ...op.danger ? { danger: true } : {}
    });
    if (!ok) return { ok: false };
  }
  let confirm_text;
  if (COMMAND_SPECS[op.action].confirm === 2) {
    const ok = await hostnameDialog(
      op.action === "host_power_cycle" ? {
        title: "\u96FB\u6E90\u3092\u5165\u308C\u76F4\u3059\uFF08\u6700\u7D42\u78BA\u8A8D\uFF09",
        note: "\u767B\u9332\u5F8C 1 \u5206\u9593\u306F\u53D6\u308A\u6D88\u305B\u307E\u3059\u3002\u30D7\u30E9\u30B0\u3092\u30AA\u30D5\u306B\u3057\u3001\u7D04 1 \u5206\u5F8C\u306B\u30AA\u30F3\u306B\u3057\u307E\u3059\u3002\u623B\u3089\u306A\u3044\u3068\u304D\u306F SwitchBot \u30A2\u30D7\u30EA\u3067\u624B\u52D5\u3067\u30AA\u30F3\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
        okLabel: "\u96FB\u6E90\u306E\u5165\u308C\u76F4\u3057\u3092\u767B\u9332"
      } : {
        title: "\u30DB\u30B9\u30C8\u3092\u518D\u8D77\u52D5\uFF08\u6700\u7D42\u78BA\u8A8D\uFF09",
        note: "\u767B\u9332\u5F8C 1 \u5206\u9593\u306F\u53D6\u308A\u6D88\u305B\u307E\u3059\u3002VM \u3092\u6B62\u3081\u3066\u304B\u3089\u518D\u8D77\u52D5\u3057\u3001\u623B\u308B\u307E\u3067\u6570\u5206\u304B\u304B\u308A\u307E\u3059\u3002",
        okLabel: "\u518D\u8D77\u52D5\u3092\u767B\u9332"
      }
    );
    if (!ok) return { ok: false };
    confirm_text = "host";
  }
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: op.action,
      ...args ? { args } : {},
      ...confirm_text ? { confirm_text } : {}
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
async function runDirOp(env, action, dir) {
  const dialog = {
    rc_start_dir: {
      title: "Remote Control \u3092\u8D77\u52D5",
      body: `\u30D5\u30A9\u30EB\u30C0\u300C${dir}\u300D\u3092 Claude Code \u306E\u4FE1\u983C\u6E08\u307F\u30D5\u30A9\u30EB\u30C0\u3068\u3057\u3066\u8A18\u9332\u3057\uFF08\u305D\u306E\u30DE\u30B7\u30F3\u306E ~/.claude.json\uFF09\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u696D\u5834\u6240\u306B\u3057\u305F Remote Control \u3092\u7ACB\u3061\u4E0A\u3052\u307E\u3059\u3002\u4FE1\u983C\u3059\u308B\u3068\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u306B\u3042\u308B CLAUDE.md\u30FB\u30D5\u30C3\u30AF\u30FB\u8A2D\u5B9A\u304C\u8AAD\u307F\u8FBC\u307E\u308C\u307E\u3059\u3002Claude \u30A2\u30D7\u30EA\u306B\u306F\u30D5\u30A9\u30EB\u30C0\u540D\u3067\u8868\u793A\u3055\u308C\u307E\u3059\u3002`,
      okLabel: "\u8D77\u52D5"
    },
    rc_stop_dir: {
      title: "Remote Control \u3092\u505C\u6B62",
      body: `\u30D5\u30A9\u30EB\u30C0\u300C${dir}\u300D\u306E Remote Control \u3092\u6B62\u3081\u307E\u3059\u3002\u9032\u884C\u4E2D\u306E\u4F1A\u8A71\u306F\u5207\u308C\u307E\u3059\u3002`,
      okLabel: "\u505C\u6B62"
    }
  }[action];
  const ok = await confirmDialog({
    title: `${titleOf(env)}\uFF1A${dialog.title}`,
    body: dialog.body,
    okLabel: dialog.okLabel
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({ id: crypto.randomUUID(), env, action, args: { dir } });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
async function cancelOp(c) {
  const ok = await confirmDialog({
    title: `\u300C${actionLabel(c.action)}\u300D\u3092\u53D6\u308A\u6D88\u3059`,
    body: "\u307E\u3060\u5B9F\u884C\u3055\u308C\u3066\u3044\u306A\u3044\u6307\u793A\u3092\u53D6\u308A\u6D88\u3057\u307E\u3059\u3002",
    okLabel: "\u53D6\u308A\u6D88\u3059"
  });
  if (!ok) return { ok: false };
  try {
    await api.cancelCommand(c.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
function msgOf(e) {
  if (e instanceof ApiFailure) return e.message;
  return "\u30A8\u30E9\u30FC\u304C\u8D77\u304D\u307E\u3057\u305F";
}
function commandTarget(c) {
  const a = c.args;
  if (!a) return "";
  if (a.dir) return a.dir;
  if (a.permission_mode)
    return a.permission_mode === "bypassPermissions" ? "\u6A29\u9650\u306E\u78BA\u8A8D\u3092\u7701\u304F" : "\u6A29\u9650\u3092\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B";
  return "";
}
function commandName(c) {
  if (c.action === "rc_mkdir" && c.args?.start) return "\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210\u3057\u3066\u8D77\u52D5";
  return ACTION_LABEL[c.action] ?? c.action;
}
function activeBox(c, serverOffset, canCancel) {
  const now = Date.now() + serverOffset;
  const name = commandName(c);
  const target = commandTarget(c);
  let state2;
  let dotClass = "s-warn";
  if (c.status === "running") {
    state2 = "\u5B9F\u884C\u4E2D\u2026";
  } else if (c.not_before && c.not_before > now) {
    const left = Math.max(0, Math.ceil((c.not_before - now) / 1e3));
    state2 = `${left}\u79D2\u5F8C\u306B\u5B9F\u884C\uFF08\u305D\u308C\u307E\u3067\u53D6\u308A\u6D88\u305B\u307E\u3059\uFF09`;
    dotClass = "s-bad";
  } else if (c.executor === "cloud") {
    state2 = "\u5F85\u6A5F\u4E2D\uFF081 \u5206\u4EE5\u5185\u306B\u5B9F\u884C\uFF09";
  } else {
    state2 = "\u5F85\u6A5F\u4E2D\uFF08\u6B21\u306E\u5831\u544A\u3067\u5B9F\u884C\uFF09";
  }
  const by = c.requested_by.split("@")[0] ?? "";
  const mark = dotClass === "s-bad" ? "dot" : "spin";
  return html`
    <div class="active-box" data-command-id="${c.id}">
      <span class="label ${dotClass}"
        ><span class="${mark}" aria-hidden="true"></span
        ><b>${name}</b>${target ? html`<span class="mono">${target}</span>` : ""}<span class="muted"
          >${state2} · ${by}</span
        ></span
      >
      ${c.status === "queued" && canCancel ? html`<button type="button" class="btn" data-cancel="${c.id}">取り消す</button>` : ""}
    </div>
  `;
}
async function runMkdirOp(env, dir, start) {
  if (!isRcDirName(dir) || dir.startsWith(".")) {
    return {
      ok: false,
      message: "\u30D5\u30A9\u30EB\u30C0\u540D\u306F\u82F1\u6570\u5B57\u3067\u59CB\u3081\u3001\u82F1\u6570\u5B57\u30FB\u7A7A\u767D\u30FB. _ - \u3060\u3051\u300164 \u6587\u5B57\u307E\u3067\u306B\u3057\u3066\u304F\u3060\u3055\u3044"
    };
  }
  const ok = await confirmDialog({
    title: `${titleOf(env)}\uFF1A\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210`,
    body: start ? `\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u306E\u76F4\u4E0B\u306B\u300C${dir}\u300D\u3092\u4F5C\u308A\u3001\u4FE1\u983C\u6E08\u307F\u30D5\u30A9\u30EB\u30C0\u3068\u3057\u3066\u8A18\u9332\u3057\u3066\u3001\u305D\u306E\u307E\u307E Remote Control \u3092\u7ACB\u3061\u4E0A\u3052\u307E\u3059\u3002` : `\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u306E\u76F4\u4E0B\u306B\u300C${dir}\u300D\u3092\u4F5C\u308A\u307E\u3059\u3002`,
    okLabel: start ? "\u4F5C\u6210\u3057\u3066\u8D77\u52D5" : "\u4F5C\u6210"
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: "rc_mkdir",
      args: start ? { dir, start: true } : { dir }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
async function runClaudePermissionOp(env, mode) {
  const on = mode === "bypassPermissions";
  const ok = await confirmDialog({
    title: `${titleOf(env)}\uFF1AClaude Code \u306E\u65E2\u5B9A\u3067${on ? "\u6A29\u9650\u306E\u78BA\u8A8D\u3092\u7701\u304F" : "\u6A29\u9650\u3092\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"}`,
    body: on ? "\u3053\u306E Mac \u306E ~/.claude/settings.json \u3067\u3001\u65E2\u5B9A\u306E\u6A29\u9650\u30E2\u30FC\u30C9\u3092 bypassPermissions \u306B\u3057\u3001\u8D77\u52D5\u6642\u306E\u78BA\u8A8D\u30C0\u30A4\u30A2\u30ED\u30B0\u3082\u51FA\u3055\u306A\u3044\u3088\u3046\u306B\u3057\u307E\u3059\u3002\u30BF\u30FC\u30DF\u30CA\u30EB\u3067 claude \u3092\u8D77\u52D5\u3057\u305F\u3068\u304D\u3001\u30D5\u30A1\u30A4\u30EB\u306E\u66F8\u304D\u8FBC\u307F\u3084\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u306E\u305F\u3073\u306B\u8A31\u53EF\u3092\u6C42\u3081\u306A\u304F\u306A\u308A\u307E\u3059\u3002\u6B21\u306B\u8D77\u52D5\u3059\u308B claude \u304B\u3089\u52B9\u304D\u307E\u3059\uFF08\u52D5\u3044\u3066\u3044\u308B Remote Control \u3084\u4F1A\u8A71\u306F\u5207\u308C\u307E\u305B\u3093\uFF09\u3002" : "\u3053\u306E Mac \u306E ~/.claude/settings.json \u3067\u3001\u65E2\u5B9A\u306E\u6A29\u9650\u30E2\u30FC\u30C9\u3092 default \u306B\u623B\u3057\u307E\u3059\u3002\u6B21\u306B\u8D77\u52D5\u3059\u308B claude \u304B\u3089\u3001\u66F8\u304D\u8FBC\u307F\u3084\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u306E\u305F\u3073\u306B\u8A31\u53EF\u3092\u6C42\u3081\u308B\u3088\u3046\u306B\u306A\u308A\u307E\u3059\u3002\u57FA\u790E\u8A2D\u5B9A\u306E\u3053\u306E\u9805\u76EE\u306F\u300C\u8981\u5BFE\u5FDC\u300D\u306B\u306A\u308A\u307E\u3059\u3002",
    okLabel: on ? "\u7701\u304F" : "\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: "claude_permission_set",
      args: { permission_mode: mode }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
async function runPermissionOp(env, mode) {
  const on = mode === "bypassPermissions";
  const ok = await confirmDialog({
    title: `${titleOf(env)}\uFF1A${on ? "\u6A29\u9650\u306E\u78BA\u8A8D\u3092\u7701\u304F" : "\u6A29\u9650\u3092\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"}`,
    body: on ? "Remote Control \u3092 bypassPermissions \u3067\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059\u3002Claude \u30A2\u30D7\u30EA\u3067\u30D5\u30A1\u30A4\u30EB\u306E\u66F8\u304D\u8FBC\u307F\u3084\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u306E\u305F\u3073\u306B\u8A31\u53EF\u3092\u6C42\u3081\u306A\u304F\u306A\u308A\u307E\u3059\u3002\u9032\u884C\u4E2D\u306E\u4F1A\u8A71\u306F\u5207\u308C\u307E\u3059\uFF08\u300C\u524D\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u623B\u3059\u300D\u3067\u623B\u305B\u307E\u3059\uFF09\u3002" : "Remote Control \u3092\u65E2\u5B9A\u306E\u6A29\u9650\u30E2\u30FC\u30C9\u3067\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059\u3002\u66F8\u304D\u8FBC\u307F\u3084\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u306E\u305F\u3073\u306B Claude \u30A2\u30D7\u30EA\u3067\u8A31\u53EF\u3092\u6C42\u3081\u308B\u3088\u3046\u306B\u306A\u308A\u307E\u3059\u3002\u9032\u884C\u4E2D\u306E\u4F1A\u8A71\u306F\u5207\u308C\u307E\u3059\u3002",
    okLabel: on ? "\u7701\u304F" : "\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: "rc_permission_set",
      args: { permission_mode: mode }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

// ui/vncpw.ts
var HIDE_MS = 6e4;
var timer;
async function showVncPassword(env, button) {
  const box = document.getElementById("vnc-pw");
  if (!box) return;
  button.setAttribute("disabled", "");
  try {
    const r = await api.vncPassword(env);
    box.innerHTML = html`<code>${r.password}</code>
      <button type="button" class="btn" data-copy="${r.password}">コピー</button>
      <span class="small muted">60 秒で消えます</span>`;
    box.hidden = false;
    if (timer !== void 0) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      box.innerHTML = "";
      box.hidden = true;
    }, HIDE_MS);
  } catch (e) {
    box.innerHTML = html`<span class="small muted"
      >${e instanceof ApiFailure ? e.message : "\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"}</span
    >`;
    box.hidden = false;
  } finally {
    button.removeAttribute("disabled");
  }
}

// ui/audit.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function auditView(a, now) {
  if (a.action === "vnc.password.view") {
    return {
      time: dayTime(a.at, now),
      op: "VNC \u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u8868\u793A",
      target: a.target && isEnv(a.target) ? shortOf(a.target) : a.target ?? "\u2014",
      actor: actorName(a.actor_email),
      result: "\u8868\u793A",
      resultTone: "muted"
    };
  }
  if (a.action === "notify.test") {
    const ok = a.detail === "sent";
    return {
      time: dayTime(a.at, now),
      op: "Slack \u306B\u30C6\u30B9\u30C8\u901A\u77E5",
      target: "Slack",
      actor: actorName(a.actor_email),
      result: ok ? "\u9001\u4FE1" : "\u5931\u6557",
      resultTone: ok ? "muted" : "bad"
    };
  }
  const [, verb] = a.action.split(".");
  const detail = a.detail ?? "";
  const op = UUID_RE.test(detail) ? `\u6307\u793A ${detail.slice(0, 8)}` : actionLabel(detail || a.action);
  const target = a.target && isEnv(a.target) ? shortOf(a.target) : a.target ?? "\u2014";
  const actor = actorName(a.actor_email);
  const map = {
    create: ["\u53D7\u4ED8", ""],
    cancel: ["\u53D6\u308A\u6D88\u3057", "muted"],
    running: ["\u5B9F\u884C\u4E2D", ""],
    done: ["\u5B8C\u4E86", ""],
    failed: ["\u5931\u6557", "bad"],
    expired: ["\u671F\u9650\u5207\u308C", "muted"]
  };
  const [result, resultTone] = map[verb ?? ""] ?? [a.action, ""];
  return { time: dayTime(a.at, now), op, target, actor, result, resultTone };
}
function actorName(email) {
  if (email.startsWith("agent:")) {
    const env = email.slice("agent:".length);
    return isEnv(env) ? `\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\uFF08${env}\uFF09` : "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8";
  }
  if (email.startsWith("worker:")) return "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9";
  const local = email.split("@")[0] ?? email;
  const hit = Object.values(PEOPLE).find((p) => p.name.toLowerCase() === local.toLowerCase());
  return hit ? hit.name : local;
}
function auditRows(list, now) {
  if (list.length === 0)
    return html`<tr>
      <td colspan="5" class="empty">まだ操作はありません</td>
    </tr>`;
  return list.map((a) => {
    const v = auditView(a, now);
    const cls = v.resultTone === "bad" ? "s-bad" : v.resultTone === "muted" ? "muted" : "";
    return html`<tr>
        <td class="time">${v.time}</td>
        <td>${v.op}</td>
        <td>${v.target}</td>
        <td>${v.actor}</td>
        <td class="r ${cls}">${v.result}</td>
      </tr>`;
  }).join("");
}
function eventLine(time, text) {
  return html`<div><span class="t">${time}</span><span>${raw(text)}</span></div>`;
}

// ui/overview.ts
var DISK_RESERVE_GB = 100;
var AUDIT_PREVIEW = 5;
function renderOverview(s, me, audit, serverOffset, opts) {
  void me;
  void serverOffset;
  const hb = hostHeartbeat(s)?.host;
  const spec = hb ? `CPU ${hb.cpu_cores ?? "\u2014"}\u30B3\u30A2 \xB7 \u30E1\u30E2\u30EA ${hb.mem_total_gb ?? "\u2014"}GB \xB7 SSD ${hb.disk_total_gb ?? "\u2014"}GB` : null;
  const plug = s.plug_enabled ? plugRow(s) : null;
  const plugText = plug ? `\u96FB\u6E90\u30D7\u30E9\u30B0 ${plug.value}${s.plug?.ok && s.plug.watts !== null ? ` \xB7 ${s.plug.watts}W` : ""}` : null;
  $("hero-sub").innerHTML = html`<span>${SITE.machine_name} · ${s.envs.length}環境</span
    ><span>最終受信 ${ago(s.host_received_at, s.now)}</span
    >${spec ? html`<span>${spec}</span>` : ""}${plugText ? html`<span>${plugText}</span>` : ""}`;
  const ov = overall(s);
  const pill = $("overall");
  pill.className = `pill s-${ov.tone}`;
  pill.innerHTML = html`<span class="dot"></span>${ov.label}`;
  renderBanners(s);
  $("env-body").innerHTML = s.envs.map((e) => envRow(e, s)).join("");
  renderUsage(s);
  renderAlloc(s);
  renderAudit(audit, s, opts.auditAll);
  renderEvents(s);
}
function bannerHtml(b, link) {
  return html`<div class="banner ${b.level}" role="status">
    <span class="status s-${b.level === "error" ? "bad" : "warn"}"><span class="dot"></span></span>
    <strong>${b.title}</strong>
    ${link ? html`<a class="link" href="${link.href}">${link.label} →</a>` : ""}
    ${b.body ? html`<span class="body">${b.body}</span>` : ""}
  </div>`;
}
function renderBanners(s) {
  const bs = banners(s);
  const bn = $("banners");
  bn.hidden = bs.length === 0;
  bn.innerHTML = bs.map((b) => {
    const env = s.envs.map((x) => x.env).find((x) => b.title.includes(`\uFF08${x}\uFF09`));
    return bannerHtml(
      b,
      env ? { href: `/${env}.html`, label: `${PEOPLE[env].name} \u306E\u74B0\u5883\u3092\u958B\u304F` } : void 0
    );
  }).join("");
}
function envRow(e, s) {
  const p = PEOPLE[e.env];
  const v = judge(e, s);
  const rs = rows(e, s);
  const sh = shares(s)[e.env] ?? { cpu: null, mem: null, disk: null };
  const pct = (n) => n === null ? "\u2014" : `${n}%`;
  const setup = e.heartbeat?.setup;
  const sm = setup ? summarizeSetup(setup) : null;
  const cell = (r) => html`<td class="hide-sm ${r.tone === "ok" || r.tone === "none" ? "" : `s-${r.tone}`}">
      ${r.value}
    </td>`;
  return html`<tr class="clickable" data-href="/${e.env}.html">
    <td>
      <span class="who"
        ><span class="avatar" aria-hidden="true">${p.initial}</span>
        <span class="n"
          ><b><a href="/${e.env}.html">${p.name}</a></b
          ><span>${e.env} · ${p.account} · ${ago(e.agent_received_at, s.now)}</span></span
        ></span
      >
    </td>
    <td>
      <span class="status s-${v.tone}"><span class="dot"></span>${v.label}</span>
      ${sm && sm.ng > 0 ? html`<span class="small s-warn" style="display: block; margin-top: 2px"
              >基礎設定 ${sm.ng} 件未完了</span
            >` : ""}
    </td>
    ${raw(rs.map(cell).join(""))}
    <td class="r num">${pct(sh.cpu)}</td>
    <td class="r num">${pct(sh.mem)}</td>
    <td class="r num">${pct(sh.disk)}</td>
  </tr>`;
}
function renderUsage(s) {
  const sh = shares(s);
  const h = hostHeartbeat(s)?.host;
  const down = hostLiveness(s) === "unresponsive" || !h;
  const order = s.envs.map((e) => e.env);
  const tiles = ["cpu", "mem", "disk"].map((k) => {
    const label = { cpu: "CPU", mem: "\u30E1\u30E2\u30EA", disk: "\u30C7\u30A3\u30B9\u30AF" }[k];
    const vals = order.map((e) => sh[e]?.[k] ?? null);
    const known = vals.every((v) => v !== null) && !down;
    const total = known ? Math.round(vals.reduce((a, v) => a + (v ?? 0), 0) * 10) / 10 : null;
    let detail = "";
    if (h && k === "mem" && h.mem_used_gb !== void 0 && h.mem_total_gb !== void 0)
      detail = `${h.mem_used_gb.toFixed(1)} / ${h.mem_total_gb} GB`;
    if (h && k === "disk" && h.disk_used_gb !== void 0 && h.disk_total_gb !== void 0)
      detail = `${Math.round(h.disk_used_gb)} / ${h.disk_total_gb} GB`;
    if (k === "cpu") detail = "\u4F7F\u7528";
    const segs = order.map((e, i) => ({ cls: PEOPLE[e].shade, w: known ? vals[i] ?? 0 : 0 }));
    const parts = order.map((e, i) => `${PEOPLE[e].name} ${known ? vals[i] : "\u2014"}`);
    if (total !== null) parts.push(`\u7A7A\u304D ${Math.max(0, 100 - total)}`);
    return html`<div class="tile">
      <span class="k">${label}</span>
      <span class="v"
        >${total === null ? "\u2014" : `${total}%`}<small>${known ? detail : ""}</small></span
      >
      <div
        class="meter"
        role="img"
        aria-label="${label} ${total === null ? "\u4E0D\u660E" : `\u5408\u8A08${total}%\u3001${parts.join("\u3001")}`}"
      >
        ${raw(segs.map((x) => `<div class="${x.cls}" style="width: ${x.w}%"></div>`).join(""))}
      </div>
      <span class="sub num">${parts.join(" \xB7 ")}</span>
    </div>`;
  });
  $("usage-card").innerHTML = html`<div class="tiles">${raw(tiles.join(""))}</div>`;
}
function renderAlloc(s) {
  const h = hostHeartbeat(s)?.host;
  const vms = s.envs.filter((e) => e.env !== "host").map((e) => ({ env: e.env, alloc: e.vm_view?.alloc }));
  const card = $("alloc-card");
  if (!h || vms.some((v) => !v.alloc)) {
    card.innerHTML = html`<p class="empty">配分は host の報告から表示します（未受信）</p>`;
    return;
  }
  const n = (v, unit) => v === void 0 ? "\u2014" : `${v}${unit}`;
  const sum = (k) => vms.every((v) => v.alloc?.[k] !== void 0) ? vms.reduce((a, v) => a + (v.alloc?.[k] ?? 0), 0) : void 0;
  const vmMem = sum("mem_gb");
  const vmDisk = sum("disk_gb");
  const vmCpu = sum("cpu");
  const hostMem = h.mem_total_gb !== void 0 && vmMem !== void 0 ? h.mem_total_gb - vmMem : void 0;
  const hostDisk = h.disk_total_gb !== void 0 && vmDisk !== void 0 ? Math.max(0, h.disk_total_gb - vmDisk - DISK_RESERVE_GB) : void 0;
  const hostCpu = h.cpu_cores !== void 0 && vmCpu !== void 0 ? vms.length === 0 ? `\u5168\u30B3\u30A2\uFF08${h.cpu_cores}\uFF09` : `\u5168\u30B3\u30A2\u3092\u5171\u6709\uFF08\u6B8B\u308A ${Math.max(0, h.cpu_cores - vmCpu)}\uFF09` : "\u2014";
  const row = (name, cpu, mem, disk, muted = false) => html`<tr class="${muted ? "muted" : ""}">
      <td>${name}</td>
      <td class="r num">${cpu}</td>
      <td class="r num">${mem}</td>
      <td class="r num">${disk}</td>
    </tr>`;
  card.innerHTML = html`<table>
    <thead>
      <tr>
        <th></th>
        <th class="r">CPU</th>
        <th class="r">メモリ</th>
        <th class="r">ディスク</th>
      </tr>
    </thead>
    <tbody>
      ${raw(
    [
      row(
        `${SITE.machine_name} \u5168\u4F53`,
        n(h.cpu_cores, "\u30B3\u30A2"),
        n(h.mem_total_gb, "GB"),
        n(h.disk_total_gb, "GB")
      ),
      row(`${PEOPLE.host.name}\uFF08\u672C\u4F53\uFF09`, hostCpu, n(hostMem, "GB"), n(hostDisk, "GB")),
      ...vms.map(
        (v) => row(
          shortOf(v.env),
          n(v.alloc?.cpu, "\u30B3\u30A2"),
          n(v.alloc?.mem_gb, "GB"),
          n(v.alloc?.disk_gb, "GB")
        )
      ),
      row("\u7A7A\u3051\u3066\u304A\u304F\u5206\uFF08macOS \u7528\uFF09", "\u2014", "\u2014", `${DISK_RESERVE_GB}GB`, true)
    ].join("")
  )}
    </tbody>
  </table>`;
}
function renderAudit(audit, s, all) {
  const foot = $("audit-foot");
  if (!audit) {
    foot.hidden = true;
    return;
  }
  const list = all ? audit : audit.slice(0, AUDIT_PREVIEW);
  $("audit-body").innerHTML = auditRows(list, s.now);
  const more = audit.length > AUDIT_PREVIEW;
  foot.dataset.hasMore = more ? "1" : "";
  $("audit-more").textContent = all ? "\u6700\u65B0 5 \u4EF6\u3060\u3051\u8868\u793A" : `\u3059\u3079\u3066\u306E\u5C65\u6B74\u3092\u8868\u793A\uFF08${audit.length}\u4EF6\uFF09\u2192`;
  if (!more) foot.hidden = true;
}
function renderEvents(s) {
  const ev = [];
  for (const b of banners(s)) ev.push(eventLine(dayTime(s.now, s.now), html`${b.title}`));
  for (const e of s.envs) {
    if (e.active) {
      const t = e.active.started_at ?? e.active.created_at;
      ev.push(eventLine(dayTime(t, s.now), html`${shortOf(e.env)}：${activeLabel(e)}`));
    }
    const m = e.heartbeat?.maintenance;
    if (m?.last_run_at && m.last_result && m.last_result !== "ok") {
      ev.push(
        eventLine(
          dayTime(m.last_run_at, s.now),
          html`${shortOf(e.env)}の夜間メンテナンス：${MAINT[m.last_result] ?? m.last_result}`
        )
      );
    }
  }
  $("events").innerHTML = ev.length > 0 ? ev.join("") : html`<div class="empty">いまのところ問題はありません</div>`;
}
var MAINT = {
  ok: "\u6B63\u5E38",
  updated: "\u66F4\u65B0\u3042\u308A",
  busy: "\u4F5C\u696D\u4E2D\u306E\u305F\u3081\u898B\u9001\u308A",
  failed: "\u5931\u6557",
  skipped: "\u898B\u9001\u308A"
};
function activeLabel(e) {
  const c = e.active;
  if (!c) return "";
  return c.status === "running" ? "\u6307\u793A\u3092\u5B9F\u884C\u4E2D" : "\u6307\u793A\u3092\u5F85\u6A5F\u4E2D";
}

// ui/envpage.ts
var DISK_RESERVE_GB2 = 100;
var RC_DIR_PENDING_LABEL = {
  rc_mkdir: "\u4F5C\u6210\u4E2D",
  rc_start_dir: "\u8D77\u52D5\u4E2D",
  rc_stop_dir: "\u505C\u6B62\u4E2D"
};
var WAIT_NOTE = raw(
  html`<span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます`
);
function renderEnvPage(ctx) {
  const { env, me, s } = ctx;
  const e = s.envs.find((x) => x.env === env);
  if (!e) return;
  const p = PEOPLE[env];
  const v = judge(e, s);
  const canUse = canOperate(me, env);
  const down = hostLiveness(s) === "unresponsive";
  const own = down ? null : e.heartbeat;
  $("env-title").textContent = titleOf(env);
  document.title = `${titleOf(env)} \xB7 ${SITE.app_name}`;
  const av = document.querySelector(".avatar.lg");
  if (av) av.textContent = PEOPLE[env].initial;
  const version = own?.claude.version ? `Claude Code ${own.claude.version}${own.claude.channel ? `\uFF08${own.claude.channel}\uFF09` : ""}` : null;
  $("hero-sub").innerHTML = html`<span>${env} · ${p.account}</span>${version ? html`<span>${version}</span>` : ""}<span>最終受信 ${ago(e.agent_received_at, s.now)}</span>`;
  const pill = $("overall");
  pill.className = `pill s-${v.tone}`;
  pill.innerHTML = html`<span class="dot"></span>${v.label}`;
  $("head-actions").innerHTML = canUse ? html`<a class="btn" href="https://ssh-${env}.${SITE.domain}" rel="noopener"
          >${raw(ICON_TERM)} SSH</a
        ><a class="btn primary" href="https://vnc-${env}.${SITE.domain}" rel="noopener"
          >${raw(ICON_SCREEN)} 画面共有</a
        >` : "";
  const bs = banners(s).filter((b) => b.title.includes(`\uFF08${env}\uFF09`) || b.title.startsWith("Mac"));
  const bn = $("banners");
  bn.hidden = bs.length === 0;
  bn.innerHTML = bs.map((b) => bannerHtml(b)).join("");
  for (const a of document.querySelectorAll(".tabs a[data-needs-use]"))
    a.hidden = !canUse;
  renderState(ctx, e);
  renderMetrics(ctx, e);
  renderTodo(ctx, e, canUse);
  renderFacts(ctx, e);
  renderConnection(ctx, e, canUse);
  renderAccount(ctx, canUse);
  renderOps(ctx, e, canUse);
  renderRcDirs(ctx, e, canUse);
  renderSetup(ctx, e);
  renderHistory(ctx);
}
function renderState(ctx, e) {
  const { s } = ctx;
  const rs = rows(e, s);
  const down = hostLiveness(s) === "unresponsive";
  const own = down ? null : e.heartbeat;
  const rc = own?.rc_dirs;
  const rcSub = rc ? (() => {
    const run = rc.running.filter((r) => r.state === "running").length;
    const err = rc.running.filter((r) => r.state === "error").length;
    if (run === 0 && err === 0) return "\u30D5\u30A9\u30EB\u30C0\u5225\u306E\u8D77\u52D5\u306A\u3057";
    return `\u30D5\u30A9\u30EB\u30C0\u5225 ${run} \u7A3C\u50CD${err ? ` \xB7 ${err} \u30A8\u30E9\u30FC` : ""}`;
  })() : "";
  const subs = {
    "Claude Code": own?.claude.last_restart ? `\u6700\u7D42\u518D\u8D77\u52D5 ${dayTimeLong(own.claude.last_restart, s.now)}` : "",
    "Remote Control": rcSub,
    Codex: "",
    \u30A8\u30FC\u30B8\u30A7\u30F3\u30C8: own ? `v${own.agent_version} \xB7 \u8D77\u52D5 ${dayTimeLong(own.agent_started_at, s.now)}` : "",
    VM: e.vm_view?.ip ? `\u5185\u90E8IP ${e.vm_view.ip}` : ""
  };
  const tiles = [...rs];
  if (ctx.env === "host" && s.plug_enabled) tiles.push(plugRow(s));
  $("state-rows").innerHTML = tiles.map(
    (r) => html`<div class="tile">
          <span class="k">${r.label}</span>
          <span class="status s-${r.tone}"><span class="dot"></span>${r.value}</span>
          <span class="sub">${r.sub ?? subs[r.label] ?? ""}</span>
        </div>`
  ).join("");
}
function renderMetrics(ctx, e) {
  const { env, s } = ctx;
  const sh = shares(s)[env] ?? { cpu: null, mem: null, disk: null };
  const h = hostHeartbeat(s)?.host;
  const a = e.vm_view?.alloc;
  let subs = ["", "", ""];
  if (env === "host" && h) {
    const vms = s.envs.map((x) => x.vm_view?.alloc).filter((x) => !!x);
    const memVm = vms.reduce((acc, v) => acc + (v.mem_gb ?? 0), 0);
    const diskVm = vms.reduce((acc, v) => acc + (v.disk_gb ?? 0), 0);
    subs = [
      h.cpu_cores !== void 0 ? `\u5168 ${h.cpu_cores} \u30B3\u30A2\u3092\u5171\u6709` : "",
      h.mem_total_gb !== void 0 ? `\u7D04 ${h.mem_total_gb - memVm}GB \u4F7F\u3048\u308B` : "",
      h.disk_total_gb !== void 0 ? `\u7D04 ${Math.max(0, h.disk_total_gb - diskVm - DISK_RESERVE_GB2)}GB \u4F7F\u3048\u308B` : ""
    ];
  } else if (a) {
    subs = [
      a.cpu !== void 0 ? `\u5272\u308A\u5F53\u3066 ${a.cpu} \u30B3\u30A2` : "",
      a.mem_gb !== void 0 ? `\u5272\u308A\u5F53\u3066 ${a.mem_gb}GB` : "",
      a.disk_gb !== void 0 ? `\u5272\u308A\u5F53\u3066 ${a.disk_gb}GB` : ""
    ];
  }
  const tile = (label, val, sub) => html`<div class="tile">
      <span class="k">${label}</span>
      <span class="v">${val === null ? "\u2014" : `${val}%`}</span>
      <div class="meter" role="img" aria-label="${label} ${val === null ? "\u4E0D\u660E" : `${val}%`}">
        <div class="${val !== null && val >= 85 ? "hot" : "p1"}" style="width: ${val ?? 0}%"></div>
      </div>
      <span class="sub">${sub}</span>
    </div>`;
  $("state-metrics").innerHTML = tile("CPU", sh.cpu, subs[0]) + tile("\u30E1\u30E2\u30EA", sh.mem, subs[1]) + tile("\u30C7\u30A3\u30B9\u30AF", sh.disk, subs[2]);
  $("metric-note").textContent = env === "host" ? s.envs.length > 1 ? `${SITE.machine_name} \u5168\u4F53\u306E\u3046\u3061\u3001VM \u3092\u9664\u3044\u305F\u672C\u4F53\u306E\u5206` : `${SITE.machine_name} \u5168\u4F53\u306E\u5024` : `${SITE.machine_name} \u5168\u4F53\u306E\u3046\u3061\u3001\u3053\u306E VM \u306E\u5206`;
}
function renderTodo(ctx, e, canUse) {
  const { s } = ctx;
  const down = hostLiveness(s) === "unresponsive";
  const own = down ? null : e.heartbeat;
  const items = [];
  const setup = own?.setup;
  if (setup) {
    const sm = summarizeSetup(setup);
    if (sm.ng > 0)
      items.push({
        tone: "s-warn",
        text: `\u57FA\u790E\u8A2D\u5B9A ${sm.ng} \u4EF6\u672A\u5B8C\u4E86`,
        href: "#setup",
        right: sm.manualNg.length ? `\u624B\u52D5 ${sm.manualNg.length} \u4EF6` : ""
      });
  }
  if (canUse && own?.rc_dirs) {
    for (const r of own.rc_dirs.running) {
      if (r.state === "error")
        items.push({
          tone: "s-bad",
          text: `${r.dir} \u306E Remote Control \u304C\u30A8\u30E9\u30FC`,
          href: "#rc",
          right: "Remote Control"
        });
    }
  }
  if (e.active) {
    items.push({
      tone: "s-warn",
      text: e.active.status === "running" ? "\u6307\u793A\u3092\u5B9F\u884C\u4E2D" : "\u6307\u793A\u3092\u5F85\u6A5F\u4E2D",
      href: !canUse ? "#history" : RC_DIR_PENDING_LABEL[e.active.action] ? "#rc" : "#ops",
      right: !canUse ? "\u5C65\u6B74" : RC_DIR_PENDING_LABEL[e.active.action] ? "Remote Control" : "\u64CD\u4F5C"
    });
  }
  if (own?.maintenance?.last_result === "failed") {
    items.push({ tone: "s-bad", text: "\u591C\u9593\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9\u304C\u5931\u6557", href: "#history", right: "\u5C65\u6B74" });
  }
  $("todo-body").innerHTML = items.length === 0 ? html`<tr>
          <td class="empty" colspan="2">いまのところ対応は要りません</td>
        </tr>` : items.map(
    (i) => html`<tr class="clickable" data-href="${i.href}">
                <td class="wrap-text">
                  <span class="status ${i.tone}"><span class="dot"></span>${i.text}</span>
                </td>
                <td class="r">
                  <a class="link muted" href="${i.href}">${i.right} ${raw(ICON_ARROW)}</a>
                </td>
              </tr>`
  ).join("");
}
function renderFacts(ctx, e) {
  const { env, s } = ctx;
  const h = hostHeartbeat(s)?.host;
  const down = hostLiveness(s) === "unresponsive";
  const own = down ? null : e.heartbeat;
  const facts = [];
  if (env === "host" && h) {
    const vms = s.envs.map((x) => x.vm_view?.alloc).filter((a) => !!a);
    const memVm = vms.reduce((a, v) => a + (v.mem_gb ?? 0), 0);
    const diskVm = vms.reduce((a, v) => a + (v.disk_gb ?? 0), 0);
    facts.push([
      "\u5272\u308A\u5F53\u3066",
      `CPU \u5168${h.cpu_cores ?? "\u2014"}\u30B3\u30A2\u3092\u5171\u6709 \xB7 \u30E1\u30E2\u30EA \u7D04${h.mem_total_gb !== void 0 ? h.mem_total_gb - memVm : "\u2014"}GB \xB7 \u30C7\u30A3\u30B9\u30AF \u7D04${h.disk_total_gb !== void 0 ? h.disk_total_gb - diskVm - DISK_RESERVE_GB2 : "\u2014"}GB`
    ]);
    if (h.os_version) facts.push(["macOS", h.os_version]);
    if (h.tart_version) facts.push(["Tart", h.tart_version]);
    if (h.boot_at) facts.push(["\u8D77\u52D5", dayTimeLong(h.boot_at, s.now)]);
  }
  if (env === "host" && s.plug_enabled) {
    const p = plugRow(s);
    facts.push(["\u96FB\u6E90\u30D7\u30E9\u30B0", p.sub ? `${p.value} \xB7 ${p.sub}` : p.value]);
  }
  if (env !== "host") {
    const a = e.vm_view?.alloc;
    facts.push([
      "\u5272\u308A\u5F53\u3066",
      a ? `CPU ${a.cpu ?? "\u2014"}\u30B3\u30A2 \xB7 \u30E1\u30E2\u30EA ${a.mem_gb ?? "\u2014"}GB \xB7 \u30C7\u30A3\u30B9\u30AF ${a.disk_gb ?? "\u2014"}GB` : "\u2014"
    ]);
    if (e.vm_view?.ip) facts.push(["\u5185\u90E8IP", e.vm_view.ip]);
    if (own && "guest" in own) {
      const g = own.guest;
      if (g.disk_used_gb !== void 0 && g.disk_total_gb !== void 0)
        facts.push(["VM \u306E\u4E2D\u306E\u30C7\u30A3\u30B9\u30AF", `${gb(g.disk_used_gb)} / ${gb(g.disk_total_gb)}`]);
      if (g.os_version) facts.push(["macOS", g.os_version]);
      if (g.boot_at) facts.push(["VM \u306E\u8D77\u52D5", dayTimeLong(g.boot_at, s.now)]);
    }
  }
  const maint = own?.maintenance?.last_run_at ? `${dayTimeLong(own.maintenance.last_run_at, s.now)}\uFF08${MAINT[own.maintenance.last_result ?? ""] ?? own.maintenance.last_result ?? "\u2014"}\uFF09` : "\u2014";
  facts.push(["\u591C\u9593\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9", maint]);
  if (own)
    facts.push([
      "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8",
      `v${own.agent_version} \xB7 \u8D77\u52D5 ${dayTimeLong(own.agent_started_at, s.now)}`
    ]);
  $("facts").innerHTML = facts.map(
    ([k, v]) => html`<tr>
          <td>${k}</td>
          <td class="num">${v}</td>
        </tr>`
  ).join("");
}
function renderConnection(ctx, e, canUse) {
  const { env } = ctx;
  const body = $("conn-body");
  if (!canUse) {
    body.innerHTML = "";
    return;
  }
  const ip = env === "host" ? PEOPLE.host.fixedIp : e.vm_view?.ip;
  const ipText = ip ?? `[${env}\u306E\u5185\u90E8IP]`;
  const cmd = `ssh ${PEOPLE[env].login}@${ipText}`;
  const smb = `smb://${ipText}/workspace`;
  const smbCheck = hostLiveness(ctx.s) === "unresponsive" ? void 0 : e.heartbeat?.setup?.find((c) => c.key === "sharing.smb_workspace");
  const smbState = !smbCheck || smbCheck.status === "skip" ? null : smbCheck.status === "ok" ? { cls: "s-ok", text: "\u5171\u6709\u4E2D" } : smbCheck.status === "ng" ? { cls: "s-bad", text: `\u672A\u6E96\u5099\uFF1A${smbCheck.detail ?? ""}` } : { cls: "s-none", text: "\u4E0D\u660E" };
  body.innerHTML = html`<div class="cols-2">
    <div class="panel">
      <div class="panel-head">
        <div class="t">
          <span class="badge-letter" aria-hidden="true">A</span>
          <h2>ブラウザで入る</h2>
          <span class="small muted">何も入れずに使えます</span>
        </div>
      </div>
      <div class="panel-body">
        <div class="routes">
          <a class="route" href="https://ssh-${env}.${SITE.domain}" rel="noopener">
            <b>${raw(ICON_TERM)}SSH（ブラウザ）</b><span>ssh-${env}.${SITE.domain}</span>
          </a>
          <a class="route" href="https://vnc-${env}.${SITE.domain}" rel="noopener">
            <b>${raw(ICON_SCREEN)}画面共有（ブラウザ）</b><span>vnc-${env}.${SITE.domain}</span>
          </a>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="t">
          <span class="badge-letter fill" aria-hidden="true">B</span>
          <h2>アプリで入る</h2>
          <span class="small muted">WARP をオンにしてから</span>
        </div>
      </div>
      <div class="panel-body" style="padding-top: 6px; padding-bottom: 6px">
        <p class="warp-note">
          <b>先に Cloudflare One（WARP）アプリをオンにしてください。</b>
          オフのままだと
          <code>192.168.64.x</code> には届きません。入れ方は使い方ガイドの「入り方」へ。
        </p>
        <div class="cmd">
          <span class="k">SSH アプリ</span><code>${cmd}</code>
          <button type="button" class="btn" data-copy="${cmd}">コピー</button>
        </div>
        <div class="cmd">
          <span class="k">VNC アプリ</span><code>${ipText}:5900</code>
          <button type="button" class="btn" data-vnc-pw>パスワードを表示</button>
        </div>
        <div class="cmd vnc-pw" id="vnc-pw" hidden></div>
        <div class="cmd">
          <span class="k">ファイルアプリ</span><code>${smb}</code>
          <button type="button" class="btn" data-copy="${smb}">コピー</button>
        </div>
        ${smbState ? html`<p class="note">
                <span class="status ${smbState.cls}"
                  ><span class="dot"></span>${smbState.text}</span
                >
                ${smbState.cls === "s-bad" ? html`<span class="muted"
                        >（Mac 側で
                        <code>sudo bash mac/scripts/smb-workspace.sh</code
                        >。基礎設定タブにも出ます）</span
                      >` : ""}
              </p>` : ""}
        <p class="note">
          WARP をオンにしてから、iPhone の「ファイル」› … › サーバへ接続
          に上のアドレス。登録ユーザは
          <code>${PEOPLE[env].login}</code>、パスワードは Mac のログインパスワード。Wi‑Fi
          で無言で止まるときは 設定 › プライバシーとセキュリティ › ローカルネットワーク を確かめる。
        </p>
        ${ip ? "" : html`<p class="note">
                内部IPは host のエージェントが VM の状態と一緒に報告します（いまは未受信）。
              </p>`}
      </div>
      <div class="panel-foot">
        <a class="link muted" href="/guide/connect.html"
          >はじめての人は使い方ガイド（図解）へ ${raw(ICON_ARROW)}</a
        >
      </div>
    </div>
  </div>`;
}
function renderAccount(ctx, canUse) {
  const { env, me } = ctx;
  const sec = $("login-sec");
  sec.hidden = !canUse;
  if (!canUse) return;
  const p = PEOPLE[env];
  const mine = me.role === "member" ? me.envs.includes(env) : env === "host";
  const open2 = explainOpen("login");
  const sub = (t) => html`<span class="sub" data-explain-body="login" ${open2 ? "" : "hidden"}>${t}</span>`;
  const items = [
    [
      "Cloudflare Access",
      html`${mine ? me.email : "\u672C\u4EBA\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9"}${sub("\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u30FBSSH\u30FB\u753B\u9762\u5171\u6709\u3067\u5171\u901A")}`
    ],
    [
      "macOS \u30E6\u30FC\u30B6\u30FC\u540D",
      html`${PEOPLE[env].login}${sub("Access \u306E\u30E1\u30FC\u30EB\u306E @ \u3088\u308A\u524D\u3068\u540C\u3058\u306B\u3059\u308B")}`
    ],
    ["SSH \u306E\u8A8D\u8A3C", html`Cloudflare Access の短期証明書${sub("\u9375\u306E\u767B\u9332\u306F\u4E0D\u8981")}`],
    [
      "\u3053\u306E\u30DE\u30B7\u30F3\u306B\u5165\u308C\u308B\u4EBA",
      html`<span class="who"
        ><span class="avatar sm" aria-hidden="true">${p.initial}</span>${p.name}<span class="sub"
          >利用者</span
        ></span
      >`
    ],
    [
      `Claude\uFF08${p.account}\uFF09`,
      html`このマシン専用のアカウント${sub("\u30E1\u30FC\u30EB\u3068\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u30D1\u30B9\u30EF\u30FC\u30C9\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC\u3067")}`
    ],
    [
      "Codex\uFF08ChatGPT\uFF09",
      html`このマシン専用のアカウント${sub("\u30E1\u30FC\u30EB\u3068\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u30D1\u30B9\u30EF\u30FC\u30C9\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC\u3067")}`
    ],
    [
      "Remote Control \u306E\u540D\u524D",
      html`<span class="mono">${env}-（セッション名）</span
        >${sub("Claude \u30A2\u30D7\u30EA\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u4E00\u89A7\u306B\u51FA\u308B\u540D\u524D")}`
    ],
    [
      "\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0",
      html`この画面には表示しません${sub("\u30DB\u30FC\u30E0\u76F4\u4E0B\u306F\u4E0D\u53EF\uFF08\u4FE1\u983C\u8A2D\u5B9A\u304C\u4FDD\u5B58\u3055\u308C\u306A\u3044\u305F\u3081\uFF09")}`
    ]
  ];
  $("login-body").innerHTML = items.map(
    ([k, v]) => html`<tr>
          <td>${k}</td>
          <td>${raw(v)}</td>
        </tr>`
  ).join("");
  $("ssh-policy").hidden = me.role !== "owner";
}
function renderOps(ctx, e, canUse) {
  const { env, me, serverOffset } = ctx;
  const sec = $("ops-sec");
  sec.hidden = !canUse;
  if (!canUse) return;
  const busy = !!e.active;
  const vmState = e.vm_view?.vm_state;
  const hostLive = hostLiveness(ctx.s);
  const open2 = explainOpen("ops");
  $("active-cmd").innerHTML = e.active ? activeBox(e.active, serverOffset, canOperate(me, env)) : "";
  const mode = e.heartbeat?.claude.rc_permission_mode;
  const permAllowed = canOperate(me, env);
  const permRow = html`<tr>
    <td class="wrap-text">
      権限の確認を省く（bypassPermissions）
      <span class="meta"
        >${mode === void 0 ? "\uFF08\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u672A\u5BFE\u5FDC\uFF09" : mode === "bypassPermissions" ? "\u73FE\u5728\uFF1A\u7701\u304F" : "\u73FE\u5728\uFF1A\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"}</span
      >
      <span class="d" data-explain-body="ops" ${open2 ? "" : "hidden"}
        >オンにすると、Claude
        アプリでファイルの書き込みやコマンド実行のたびに許可を求めなくなります。この Mac は Claude
        専用なので既定はオンです。切り替えると Remote Control を立て直します。</span
      >
      ${!permAllowed ? html`<span class="why">本人かオーナーだけが切り替えられます</span>` : busy ? html`<span class="why waiting"><span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます</span>` : ""}
    </td>
    <td class="r">
      <button
        type="button"
        class="btn wide"
        data-rc-perm="${mode === "bypassPermissions" ? "default" : "bypassPermissions"}"
        ${busy || !permAllowed || mode === void 0 ? "disabled" : ""}
      >
        ${mode === "bypassPermissions" ? "\u30AA\u30D5\u306B\u3059\u308B" : "\u30AA\u30F3\u306B\u3059\u308B"}
      </button>
    </td>
  </tr>`;
  const dbp = e.heartbeat?.setup?.find((c) => c.key === "claude.default_bypass");
  const claudeOn = dbp === void 0 ? void 0 : dbp.status === "ok";
  const claudeUnknown = dbp === void 0 || dbp.status === "unknown" || dbp.status === "skip";
  const claudePermRow = html`<tr>
    <td class="wrap-text">
      Claude Code の既定で権限の確認を省く
      <span class="meta"
        >${dbp === void 0 ? "\uFF08\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u672A\u5BFE\u5FDC\uFF09" : claudeUnknown ? "\u73FE\u5728\uFF1A\u4E0D\u660E" : claudeOn ? "\u73FE\u5728\uFF1A\u7701\u304F" : "\u73FE\u5728\uFF1A\u6BCE\u56DE\u78BA\u8A8D\u3059\u308B"}</span
      >
      <span class="d" data-explain-body="ops" ${open2 ? "" : "hidden"}
        >ターミナルで claude を起動したときの既定です（~/.claude/settings.json）。オンにすると、
        ファイルの書き込みやコマンド実行のたびに許可を求めず、起動時の確認ダイアログも出ません。次に起動する
        claude から効き、動いている Remote Control
        は切れません。基礎設定ではオンが正しい状態です。</span
      >
      ${!permAllowed ? html`<span class="why">本人かオーナーだけが切り替えられます</span>` : busy ? html`<span class="why waiting"><span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます</span>` : ""}
    </td>
    <td class="r">
      <button
        type="button"
        class="btn wide"
        data-claude-perm="${claudeOn ? "default" : "bypassPermissions"}"
        ${busy || !permAllowed || dbp === void 0 ? "disabled" : ""}
      >
        ${claudeOn ? "\u30AA\u30D5\u306B\u3059\u308B" : "\u30AA\u30F3\u306B\u3059\u308B"}
      </button>
    </td>
  </tr>`;
  const ops = opsFor(env);
  const normal = ops.filter((o) => !o.danger);
  const danger = ops.filter((o) => o.danger);
  const row = (op) => {
    const allowed = canPress(me, env, op.action);
    let disabled = busy || !allowed;
    let why = "";
    if (!allowed) why = "\u30AA\u30FC\u30CA\u30FC\u3060\u3051\u304C\u5B9F\u884C\u3067\u304D\u307E\u3059";
    else if (busy) why = WAIT_NOTE;
    else if (op.action === "host_power_cycle" && !ctx.s.plug_enabled) {
      disabled = true;
      why = "\u30B9\u30DE\u30FC\u30C8\u30D7\u30E9\u30B0\u304C\u672A\u8A2D\u5B9A\u3067\u3059\uFF08Worker \u306E secret\uFF09";
    } else if (op.action === "host_power_cycle" && hostLive !== "unresponsive" && hostLive !== "unknown") {
      disabled = true;
      why = `${SITE.machine_name} \u304B\u3089\u306E\u5831\u544A\u304C\u5C4A\u3044\u3066\u3044\u308B\u3042\u3044\u3060\u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08\u5148\u306B\u300C\u30DB\u30B9\u30C8\u3092\u518D\u8D77\u52D5\u300D\uFF09`;
    } else if (op.action === "vm_start" && vmState === "running") {
      disabled = true;
      why = "\u3059\u3067\u306B\u8D77\u52D5\u3057\u3066\u3044\u307E\u3059";
    } else if ((op.action === "vm_stop" || op.action === "vm_restart") && vmState === "stopped") {
      disabled = true;
      why = "VM \u306F\u505C\u6B62\u3057\u3066\u3044\u307E\u3059";
    } else if (op.action !== "vm_start" && op.action !== "vm_stop" && op.action !== "vm_restart" && env !== "host" && vmState === "stopped") {
      disabled = true;
      why = "VM \u304C\u505C\u6B62\u3057\u3066\u3044\u308B\u305F\u3081\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093";
    }
    return html`<tr class="${op.danger ? "danger" : ""}">
      <td class="wrap-text">
        ${op.name}
        <span class="d" data-explain-body="ops" ${open2 ? "" : "hidden"}>${op.desc}</span>
        ${disabled && why ? html`<span class="why${why instanceof Raw ? " waiting" : ""}">${why}</span>` : ""}
      </td>
      <td class="r">
        <button
          type="button"
          class="btn wide ${op.danger ? "danger" : ""}"
          data-op="${op.action}"
          ${disabled ? "disabled" : ""}
        >
          ${op.button}
        </button>
      </td>
    </tr>`;
  };
  $("ops-body").innerHTML = permRow + claudePermRow + normal.map(row).join("") + (danger.length ? html`<tr class="group-row">
          <td colspan="2">危険な操作（オーナーだけ・最終確認あり）</td>
        </tr>` + danger.map(row).join("") : "");
}
function renderRcDirs(ctx, e, canUse) {
  const { env, me, s, serverOffset } = ctx;
  const sec = $("rcdir-sec");
  sec.hidden = !canUse;
  if (!canUse) return;
  const rcActive = document.getElementById("rc-active");
  if (rcActive)
    rcActive.innerHTML = e.active ? activeBox(e.active, serverOffset, canOperate(me, env)) : "";
  const down = hostLiveness(s) === "unresponsive";
  const rc = down ? void 0 : e.heartbeat?.rc_dirs;
  const body = $("rcdir-body");
  const exp = $("rcdir-explain");
  if (!rc) {
    exp.textContent = "\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u306E\u76F4\u4E0B\u306B\u3042\u308B\u30D5\u30A9\u30EB\u30C0\u3054\u3068\u306B\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u696D\u5834\u6240\u306B\u3057\u305F Remote Control \u3092\u7ACB\u3061\u4E0A\u3052\u3089\u308C\u307E\u3059\u3002Claude \u30A2\u30D7\u30EA\u306B\u306F\u30D5\u30A9\u30EB\u30C0\u540D\u3067\u8868\u793A\u3055\u308C\u307E\u3059\u3002";
    body.innerHTML = html`<p class="empty">このエージェントは未対応</p>`;
    return;
  }
  exp.textContent = `\u4E00\u89A7\u306F\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\uFF08${rc.root}\uFF09\u306E\u76F4\u4E0B\u306B\u3042\u308B\u30D5\u30A9\u30EB\u30C0\u3067\u3059\u3002\u884C\u306E\u300C\u8D77\u52D5\u300D\u3067\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u696D\u5834\u6240\u306B\u3057\u305F Remote Control \u304C\u3082\u3046 1 \u3064\u7ACB\u3061\u4E0A\u304C\u308A\u307E\u3059\u3002Claude \u30A2\u30D7\u30EA\u306B\u306F\u30D5\u30A9\u30EB\u30C0\u540D\u3067\u8868\u793A\u3055\u308C\u307E\u3059\u3002\u8D77\u52D5\u3059\u308B\u3068\u304D\u306F\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u3092 Claude Code \u306E\u4FE1\u983C\u6E08\u307F\u30D5\u30A9\u30EB\u30C0\u3068\u3057\u3066\u8A18\u9332\u3057\u3066\u304B\u3089\u7ACB\u3061\u4E0A\u3052\u307E\u3059\uFF08git \u30EA\u30DD\u30B8\u30C8\u30EA\u306F\u30D5\u30A9\u30EB\u30C0\u5358\u4F4D\u3067\u4FE1\u983C\u304C\u8981\u308B\u305F\u3081\u3002\u4FE1\u983C\u3059\u308B\u3068\u3001\u305D\u306E\u30D5\u30A9\u30EB\u30C0\u306E CLAUDE.md\u30FB\u30D5\u30C3\u30AF\u30FB\u8A2D\u5B9A\u304C\u8AAD\u307F\u8FBC\u307E\u308C\u307E\u3059\uFF09\u3002`;
  const busy = !!e.active;
  const tone = (st) => st === "running" ? "s-ok" : st === "error" ? "s-bad" : "s-none";
  const stateLabel = {
    running: "\u7A3C\u50CD\u4E2D",
    starting: "\u8D77\u52D5\u4E2D",
    stopped: "\u505C\u6B62",
    error: "\u30A8\u30E9\u30FC"
  };
  const act = e.active;
  const pendingDir = act?.args?.dir && RC_DIR_PENDING_LABEL[act.action] ? act.args.dir : null;
  const pendingLabel = act && pendingDir ? act.action === "rc_mkdir" && act.args?.start ? "\u4F5C\u6210\u3057\u3066\u8D77\u52D5\u4E2D" : RC_DIR_PENDING_LABEL[act.action] ?? "" : "";
  const detailText = (d) => d === "not trusted" ? "Claude Code \u304C\u3053\u306E\u30D5\u30A9\u30EB\u30C0\u3092\u4FE1\u983C\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u300C\u8D77\u52D5\u300D\u3092\u62BC\u3059\u3068\u4FE1\u983C\u3092\u8A18\u9332\u3057\u3066\u304B\u3089\u8D77\u52D5\u3057\u76F4\u3057\u307E\u3059" : d;
  const byDir = new Map(rc.running.map((r) => [r.dir, r]));
  const names = /* @__PURE__ */ new Set([...rc.available, ...byDir.keys()]);
  if (pendingDir) names.add(pendingDir);
  const rank = (dir) => {
    if (dir === pendingDir) return 0;
    const st = byDir.get(dir)?.state;
    return st === "error" ? 1 : st === "running" || st === "starting" ? 2 : st === "stopped" ? 3 : 4;
  };
  const rows2 = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const btn = (label, attr) => html`<button type="button" class="btn" ${raw(attr)} ${busy ? "disabled" : ""}>
      ${label}
    </button>`;
  const row = (dir) => {
    const r = byDir.get(dir);
    const pending2 = dir === pendingDir;
    const state2 = pending2 ? html`<span class="status s-warn waiting"
          ><span class="spin" aria-hidden="true"></span>${pendingLabel}</span
        >` : r ? html`<span class="status ${tone(r.state)}"
            ><span class="dot"></span>${stateLabel[r.state] ?? r.state}</span
          >` : html`<span class="status s-none"><span class="dot"></span>未起動</span>`;
    const middle = r && r.state === "error" && r.detail ? html`<td colspan="2" class="detail-bad hide-sm">${detailText(r.detail)}</td>` : html`<td class="mono muted hide-sm">${r?.name ?? "\u2014"}</td>
            <td class="time hide-sm">
              ${r?.started_at ? dayTimeLong(r.started_at, s.now) : "\u2014"}
            </td>`;
    const buttons = !r ? pending2 ? "" : btn("\u8D77\u52D5", `data-rc-start="${dir}"`) : (r.state === "error" ? btn("\u8D77\u52D5", `data-rc-start="${dir}"`) : "") + btn("\u505C\u6B62", `data-rc-stop="${dir}"`);
    return html`<tr>
      <td class="mono">${dir}</td>
      <td>${state2}</td>
      ${raw(middle)}
      <td class="r"><div class="btn-row">${raw(buttons)}</div></td>
    </tr>`;
  };
  const list = rows2.length === 0 ? html`<p class="empty">
          作業フォルダ（${rc.root}）の直下にフォルダがありません。下の「新しいフォルダ」で作れます
        </p>` : html`<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>フォルダ</th>
                <th>状態</th>
                <th class="hide-sm">Claude アプリでの名前</th>
                <th class="hide-sm">起動</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows2.map(row)}
            </tbody>
          </table>
        </div>`;
  const mkform = html`<div class="rcdir-form">
    <label for="rcdir-new">新しいフォルダ</label>
    <input
      id="rcdir-new"
      type="text"
      maxlength="64"
      placeholder="例: my-project"
      autocomplete="off"
      spellcheck="false"
      ${busy ? "disabled" : ""}
    />
    <label class="chk"
      ><input type="checkbox" id="rcdir-new-start" checked /> 作成後に Remote Control を起動</label
    >
    <button type="button" class="btn" data-rc-mkdir ${busy ? "disabled" : ""}>作成</button>
  </div>`;
  const prevInput = document.getElementById("rcdir-new");
  const prevChk = document.getElementById("rcdir-new-start");
  if (prevInput && document.activeElement === prevInput) return;
  const keepName = prevInput instanceof HTMLInputElement ? prevInput.value : "";
  const keepStart = prevChk instanceof HTMLInputElement ? prevChk.checked : true;
  body.innerHTML = html`${raw(list)}${raw(mkform)}`;
  const inp = document.getElementById("rcdir-new");
  const chk = document.getElementById("rcdir-new-start");
  if (inp instanceof HTMLInputElement) inp.value = keepName;
  if (chk instanceof HTMLInputElement) chk.checked = keepStart;
}
function renderSetup(ctx, e) {
  const { env, s } = ctx;
  const down = hostLiveness(s) === "unresponsive";
  const setup = down ? void 0 : e.heartbeat?.setup;
  const sum = $("setup-sum");
  const body = $("setup-body");
  const count = $("setup-count");
  if (!setup) {
    sum.innerHTML = "";
    count.hidden = true;
    body.innerHTML = html`<p class="empty">エージェントがまだ報告していません</p>`;
    return;
  }
  const sm = summarizeSetup(setup);
  sum.className = `status ${sm.ng > 0 ? "s-warn" : "s-ok"}`;
  sum.innerHTML = html`<span class="dot"></span>${sm.ok} / ${sm.total}
    OK${sm.ng > 0 ? ` \xB7 \u8981\u5BFE\u5FDC ${sm.ng}${sm.manualNg.length ? `\uFF08\u624B\u52D5 ${sm.manualNg.length}\uFF09` : ""}` : ""}`;
  count.hidden = sm.ng === 0;
  count.className = "count warn";
  count.textContent = String(sm.ng);
  const byKey = new Map(setup.map((c) => [c.key, c]));
  const ordered = [];
  for (const k of setupKeysFor(env)) {
    const c = byKey.get(k);
    if (c && c.status !== "skip") ordered.push(c);
  }
  for (const c of setup) {
    if (c.status !== "skip" && !ordered.includes(c)) ordered.push(c);
  }
  const rank = (c) => c.status === "ng" ? SETUP_CHECK_SPECS[c.key]?.manual ? 0 : 1 : c.status === "unknown" ? 2 : 3;
  ordered.sort((a, b) => rank(a) - rank(b));
  const tone = (st) => st === "ok" ? "s-ok" : st === "ng" ? "s-bad" : "s-none";
  const line = (c) => {
    const spec = SETUP_CHECK_SPECS[c.key];
    const label = spec?.label ?? c.key;
    return html`<div class="check ${tone(c.status)} ${c.status === "ok" ? "ok" : ""}">
      <span class="dot"></span>
      <span class="label">${label}${spec?.manual ? html`<span class="tag">手動</span>` : ""}</span>
      <span class="detail">${c.detail ?? (c.status === "unknown" ? "\u672A\u78BA\u8A8D" : "")}</span>
      ${c.status === "ng" && spec ? html`<span class="how"><b>直し方</b>${spec.how}</span>` : ""}
    </div>`;
  };
  const open2 = ordered.filter((c) => c.status !== "ok");
  const done = ordered.filter((c) => c.status === "ok");
  const wasOpen = body.querySelector("details")?.open ?? false;
  body.innerHTML = html`${open2.length === 0 ? html`<p class="empty">すべて完了しています</p>` : raw(open2.map(line).join(""))}
  ${done.length ? html`<details class="fold" ${wasOpen ? "open" : ""}>
          <summary>完了した項目 ${done.length} 件</summary>
          ${raw(done.map(line).join(""))}
        </details>` : ""}`;
}
function renderHistory(ctx) {
  const { env, s, audit } = ctx;
  if (!audit) return;
  const mine = audit.filter((a) => a.target === env);
  $("history-body").innerHTML = mine.length === 0 ? html`<tr>
          <td colspan="4" class="empty">まだ操作はありません</td>
        </tr>` : mine.slice(0, 50).map((a) => {
    const v = auditView(a, s.now);
    return html`<tr>
              <td class="time">${v.time}</td>
              <td>${v.op}</td>
              <td>${v.actor}</td>
              <td
                class="r ${v.resultTone === "bad" ? "s-bad" : v.resultTone === "muted" ? "muted" : ""}"
              >
                ${v.result}
              </td>
            </tr>`;
  }).join("");
}

// ui/main.ts
var reloadedFor = null;
async function checkBuild() {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    const build = typeof body.build === "string" ? body.build : null;
    if (!build || build === "2de8886-mvz774cg" || reloadedFor === build) return;
    reloadedFor = build;
    location.reload();
  } catch {
  }
}
var BUILD_CHECK_MS = 10 * 60 * 1e3;
var POLL_MS = 5e3;
var POLL_HIDDEN_MS = 6e4;
var TABS = ["overview", "rc", "connect", "ops", "setup", "history"];
function selectTab() {
  const tabs = Array.from(document.querySelectorAll(".tabs a[data-tab]"));
  if (tabs.length === 0) return;
  const want = location.hash.slice(1);
  const visible = (id2) => !tabs.find((t) => t.dataset.tab === id2)?.hidden;
  const fallback = visible("rc") ? "rc" : "overview";
  const id = TABS.includes(want) && visible(want) ? want : fallback;
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === id));
  for (const p of document.querySelectorAll(".tabpanel")) p.hidden = p.id !== id;
}
function setupSegments() {
  for (const seg of document.querySelectorAll("[data-seg]")) {
    const key = seg.dataset.seg ?? "";
    const apply = (value) => {
      for (const b of seg.querySelectorAll("[data-seg-value]"))
        b.setAttribute("aria-pressed", String(b.dataset.segValue === value));
      for (const p of document.querySelectorAll("[data-seg-panel]")) {
        const [k, v] = (p.dataset.segPanel ?? "").split(":");
        if (k !== key) continue;
        p.hidden = v !== value;
        if (p.id === "audit-foot" && v === value) p.hidden = !p.dataset.hasMore;
      }
    };
    let saved = null;
    try {
      saved = localStorage.getItem(`seg:${key}`);
    } catch {
    }
    const first = seg.querySelector("[data-seg-value]")?.dataset.segValue ?? "";
    apply(saved ?? first);
    seg.addEventListener("click", (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("[data-seg-value]") : null;
      if (!b) return;
      const v = b.dataset.segValue ?? "";
      apply(v);
      try {
        localStorage.setItem(`seg:${key}`, v);
      } catch {
      }
    });
  }
}
var page = document.body.dataset.page ?? "";
var envAttr = document.body.dataset.env;
var pageEnv = envAttr && isEnv(envAttr) ? envAttr : null;
var state = null;
var timer2;
async function boot() {
  setupExplainButtons();
  registerServiceWorker();
  if (page === "guide") {
    api.me().then(
      (m) => {
        applySite(m.site);
        fillSiteDom();
        applyEnabledEnvs(m.enabled_envs);
      },
      () => fillSiteDom()
    );
    return;
  }
  let me;
  try {
    me = await api.me();
  } catch (e) {
    fillSiteDom();
    fail(e);
    return;
  }
  applySite(me.site);
  fillSiteDom();
  applyEnabledEnvs(me.enabled_envs);
  if (pageEnv && !me.enabled_envs.includes(pageEnv)) {
    showUnusedEnv(pageEnv);
    return;
  }
  state = { me, status: null, audit: null, serverOffset: 0, auditAll: false };
  const notifyBtn = document.getElementById("notify-test");
  if (notifyBtn && me.role === "owner") notifyBtn.hidden = false;
  wireActions();
  setupSegments();
  addEventListener("hashchange", selectTab);
  await refresh();
  window.setInterval(() => {
    const active = state?.status?.envs.some((e) => e.active?.not_before);
    if (active) render();
  }, 1e3);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkBuild();
      void refresh();
    }
  });
  void checkBuild();
  window.setInterval(() => void checkBuild(), BUILD_CHECK_MS);
}
async function refresh() {
  if (!state) return;
  window.clearTimeout(timer2);
  try {
    const [status, audit] = await Promise.all([api.status(), api.audit(50).catch(() => null)]);
    state.status = status;
    state.audit = audit;
    state.serverOffset = status.now - Date.now();
    show($("load-error"), false);
    render();
  } catch (e) {
    fail(e);
  }
  timer2 = window.setTimeout(() => void refresh(), document.hidden ? POLL_HIDDEN_MS : POLL_MS);
}
function render() {
  if (!state?.status) return;
  const { me, status, audit, serverOffset, auditAll } = state;
  if (page === "index") {
    renderOverview(status, me, audit, serverOffset, { auditAll });
    const foot = document.getElementById("audit-foot");
    const seg = document.querySelector('[data-seg="log"] [aria-pressed="true"]');
    if (foot) foot.hidden = !foot.dataset.hasMore || seg?.dataset.segValue !== "audit";
  } else if (page === "env" && pageEnv) {
    renderEnvPage({ env: pageEnv, me, s: status, audit, serverOffset });
    selectTab();
  }
}
function fillSiteDom() {
  const set = (sel, value) => {
    for (const el of document.querySelectorAll(sel)) {
      const v = value(el);
      if (v !== null) el.textContent = v;
    }
  };
  const env = (el, key) => {
    const e = el.dataset[key];
    return isEnv(e) ? PEOPLE[e][key] : null;
  };
  set("[data-name]", (el) => env(el, "name"));
  set("[data-login]", (el) => env(el, "login"));
  set("[data-domain]", () => SITE.domain);
  set("[data-dashboard-host]", () => SITE.dashboard_host);
  set("[data-team]", () => SITE.access_team);
  set("[data-org]", () => SITE.org_name);
  set("[data-org-footer]", () => SITE.org_footer);
  set("[data-app]", () => SITE.app_name);
  set("[data-machine]", () => SITE.machine_name);
  set("[data-email-domain]", () => SITE.login_email_domain || SITE.domain);
  set(
    "[data-login-domain]",
    () => SITE.login_email_domain ? `\uFF08@${SITE.login_email_domain}\uFF09` : ""
  );
  document.title = document.title.replace(/agentstation$/, SITE.app_name);
  for (const img of document.querySelectorAll('img[src="/logo.png"]'))
    img.alt = SITE.org_name;
  document.documentElement.classList.add("site-ready");
}
function applyEnabledEnvs(enabled) {
  for (const env of ["vm1", "vm2"]) {
    if (enabled.includes(env)) continue;
    for (const el of document.querySelectorAll(
      `a[href="/${env}.html"], a[href^="/${env}.html#"], [data-env-only="${env}"]`
    ))
      el.hidden = true;
  }
}
function showUnusedEnv(env) {
  const main = document.querySelector("main");
  if (!main) return;
  main.innerHTML = `<section class="panel"><div class="panel-head"><h2>${env} \u306F\u4F7F\u3063\u3066\u3044\u307E\u305B\u3093</h2></div>
    <p class="empty">\u3053\u306E\u5C0E\u5165\u3067\u306F ${env} \u3092\u4F7F\u3046\u8A2D\u5B9A\u306B\u306A\u3063\u3066\u3044\u307E\u305B\u3093\uFF08MEMBERS_JSON \u306E envs \u306B\u7121\u3044\uFF09\u3002<a href="/">\u4E00\u89A7\u306B\u623B\u308B</a></p></section>`;
}
function fail(e) {
  const el = $("load-error");
  const msg = e instanceof ApiFailure ? e.status === 401 ? "\u30ED\u30B0\u30A4\u30F3\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3001Cloudflare Access \u306B\u30ED\u30B0\u30A4\u30F3\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : `\u72B6\u614B\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\uFF1A${e.message}` : "\u72B6\u614B\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093";
  el.textContent = msg;
  show(el, true);
}
function wireActions() {
  document.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest(
      "[data-op],[data-cancel],[data-copy],[data-rc-start],[data-rc-stop],[data-rc-mkdir],[data-rc-perm],[data-claude-perm],[data-vnc-pw],[data-notify-test],[data-audit-more],tr[data-href]"
    ) : null;
    if (!t || !state?.status) return;
    if (t.dataset.rcPerm && pageEnv) {
      const mode = t.dataset.rcPerm === "bypassPermissions" ? "bypassPermissions" : "default";
      pending(t, async () => {
        const r = await runPermissionOp(pageEnv, mode);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.claudePerm && pageEnv) {
      const mode = t.dataset.claudePerm === "bypassPermissions" ? "bypassPermissions" : "default";
      pending(t, async () => {
        const r = await runClaudePermissionOp(pageEnv, mode);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.vncPw !== void 0 && pageEnv) {
      void showVncPassword(pageEnv, t);
      return;
    }
    if (t.dataset.notifyTest !== void 0) {
      pending(t, () => sendNotifyTest());
      return;
    }
    if (t.dataset.auditMore !== void 0) {
      state.auditAll = !state.auditAll;
      render();
      return;
    }
    if (t instanceof HTMLTableRowElement && t.dataset.href) {
      if (ev.target instanceof Element && ev.target.closest("a,button")) return;
      location.href = t.dataset.href;
      return;
    }
    if (t.dataset.copy !== void 0) {
      void copy(t, t.dataset.copy);
      return;
    }
    if (t.dataset.op && pageEnv) {
      const op = opsFor(pageEnv).find((o) => o.action === t.dataset.op);
      if (!op) return;
      pending(t, async () => {
        const r = await runOp(pageEnv, op, Date.now() + (state?.serverOffset ?? 0));
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.rcStart && pageEnv) {
      const dir = t.dataset.rcStart;
      pending(t, async () => {
        const r = await runDirOp(pageEnv, "rc_start_dir", dir);
        showOpError(r.message, "rcdir-error");
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.rcMkdir !== void 0 && pageEnv) {
      const inp = document.getElementById("rcdir-new");
      const chk = document.getElementById("rcdir-new-start");
      const dir = inp instanceof HTMLInputElement ? inp.value.trim() : "";
      const start = chk instanceof HTMLInputElement ? chk.checked : false;
      pending(t, async () => {
        const r = await runMkdirOp(pageEnv, dir, start);
        showOpError(r.message, "rcdir-error");
        if (r.ok) {
          const now = document.getElementById("rcdir-new");
          if (now instanceof HTMLInputElement) now.value = "";
          await refresh();
        }
      });
      return;
    }
    if (t.dataset.rcStop && pageEnv) {
      const dir = t.dataset.rcStop;
      pending(t, async () => {
        const r = await runDirOp(pageEnv, "rc_stop_dir", dir);
        showOpError(r.message, "rcdir-error");
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.cancel) {
      const id = t.dataset.cancel;
      const c = state.status.envs.map((e) => e.active).find((a) => a?.id === id);
      if (!c) return;
      pending(t, async () => {
        const r = await cancelOp(c);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
    }
  });
}
function pending(btn, fn) {
  if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
    void fn();
    return;
  }
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + label;
  void fn().finally(() => {
    if (!btn.isConnected) return;
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.innerHTML = label;
  });
}
async function sendNotifyTest() {
  const out = document.getElementById("notify-test-result");
  if (out) out.textContent = "\u9001\u4FE1\u4E2D\u2026";
  try {
    await api.notifyTest();
    if (out) out.textContent = "Slack \u306B\u9001\u308A\u307E\u3057\u305F\u3002\u30C1\u30E3\u30F3\u30CD\u30EB\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044";
    await refresh();
  } catch (e) {
    if (out) out.textContent = e instanceof ApiFailure ? e.message : "\u9001\u308C\u307E\u305B\u3093\u3067\u3057\u305F";
  }
}
function showOpError(msg, id = "op-error") {
  const el = document.getElementById(id);
  if (!el) {
    if (msg) window.alert(msg);
    return;
  }
  el.textContent = msg ?? "";
  el.hidden = !msg;
}
async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F";
    window.setTimeout(() => {
      btn.textContent = prev;
    }, 1500);
  } catch {
    window.prompt("\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044", text);
  }
}
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
  });
}
void boot();
