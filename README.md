# agentstation

**Keep Claude Code running on your own Mac, and watch and control it from your phone.**

English | [日本語](README.ja.md)

<p align="center"><img src="docs/media/overview.en.gif" width="960" alt="How it works: each environment's agent reports to Cloudflare, you check status on your phone, a disconnect is detected and sent to Slack, one tap fixes it, and you can start Remote Control for any folder from your phone"></p>
<p align="center"><sub>MP4 version: <a href="docs/media/overview.en.mp4"><code>docs/media/overview.en.mp4</code></a></sub></p>

agentstation manages Claude Code's Remote Control running on your Mac from a dashboard on Cloudflare. Alongside the Mac itself you can run up to two macOS VMs, so up to three people can share one Mac, each using their own environment from the Claude app on their phone. You can also skip the VMs and use just the Mac on your own.

## Features

- **Start Remote Control from your phone**: pick a folder and start it, then continue in the Claude app. No terminal needed.
- **Every environment at a glance**: see whether Claude Code, Remote Control, Codex and each VM are running, plus CPU, memory and disk usage.
- **One-tap recovery**: restart Remote Control, update Claude Code, restart a VM or the host, or power-cycle the Mac with a smart plug.
- **Slack alerts**: get notified when reports stop arriving or a login is required (optional).
- **SSH and screen sharing in the browser**: through Cloudflare Access, or from iPhone apps over WARP.
- **No open ports**: the Mac only makes outbound connections, and the agent runs a fixed set of operations, never arbitrary commands.

![Dashboard overview](worker/public/guide/dashboard-overview.jpg)

## Quick start

### Requirements

- An Apple Silicon Mac you can dedicate to Claude (Mac mini, Mac Studio, etc.; 24 GB of memory or more is recommended for two VMs)
- A Cloudflare account and a domain whose DNS is on Cloudflare (free plans are enough)
- An email address and a Claude account for each person
- Optional: a Slack Incoming Webhook, a SwitchBot Plug Mini

### Install

You set it up together with Claude Code.

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/agentstation.git
cd agentstation
claude
```

Then ask Claude Code (or run `/agentstation-install`):

```
Read kit/START.md and help me install this repository in my environment.
```

A script creates the Cloudflare resources for you, and `kit/doctor.mjs` checks your progress and tells you what to do next. Your part is logging in through the browser, typing sudo passwords and secrets, and checking things on the Mac. Expect half a day to a day.

The installation guide and the dashboard are in **Japanese**. Ask Claude Code to explain each step in English if you prefer.

## How it works

```
Phone / PC ──(log in via Cloudflare Access)──> Worker + D1 (dashboard)
                                                     ↑ reports every 60 s, receives commands
Mac
 ├─ host: agent, Claude Code Remote Control, cloudflared
 ├─ vm1 (optional): agent, Claude Code Remote Control
 └─ vm2 (optional): agent, Claude Code Remote Control
```

Actions you take in the dashboard are queued in D1, and each environment's agent picks them up with its next report. Passwords, tokens and conversation content are never sent to the dashboard. See [`docs/spec.md`](docs/spec.md) (Japanese) for details.

## Limitations

- Up to two VMs (Apple's macOS license allows up to two additional macOS instances in VMs per Mac).
- The UI and the installation guide are in Japanese.
- Tested with macOS 27, Claude Code 2.1.x and Tart 2.41. Status detection depends on the format of Claude Code's logs, so other versions may be misread.

## Documentation (Japanese)

| Topic                                | Location                                         |
| ------------------------------------ | ------------------------------------------------ |
| Installation guide (for Claude Code) | [`kit/START.md`](kit/START.md)                   |
| Install kit and settings file        | [`kit/README.md`](kit/README.md)                 |
| Detailed setup procedure             | [`docs/initial-setup.md`](docs/initial-setup.md) |
| Getting started for users            | [`docs/onboarding.md`](docs/onboarding.md)       |
| Troubleshooting                      | [`docs/runbook.md`](docs/runbook.md)             |
| Specification and design decisions   | [`docs/spec.md`](docs/spec.md)                   |

## Development

```bash
npm ci
npm run typecheck && npm test --workspaces --if-present && npm run lint
npm run dev    # run locally (sample data: docs/dev.md)
```

Development rules are in [`CLAUDE.md`](CLAUDE.md). Keep only sample values in the repository; never commit real email addresses, domains or Cloudflare IDs.

## License

[MIT](LICENSE)
