# Access の SSH CA 公開鍵（秘密ではない）

2026-10-31 に Zero Trust › Access controls › Service credentials › SSH で生成。各マシンの `/etc/ssh/ca.pub` に入れる（`mac/sshd/50-cloudflare-access.conf` の `TrustedUserCAKeys`）。

| ファイル | 用途 | 入れるマシン |
| --- | --- | --- |
| `ssh-host.pub` | 経路 A（ブラウザ版 SSH）ssh-host アプリの CA | host |
| `ssh-vm1.pub` | 同 ssh-vm1 | vm1 |
| `ssh-vm2.pub` | 同 ssh-vm2 | vm2 |
| `infra.pub` | 経路 B（WARP、Access for Infrastructure）の Gateway SSH CA | 3 台とも |
| `ca.pub.host` / `ca.pub.vm1` / `ca.pub.vm2` | 上の 2 本を結合した、そのまま `/etc/ssh/ca.pub` に置くファイル | それぞれ |

```bash
sudo install -m 0644 -o root -g wheel cloudflare/access/ca/ca.pub.host /etc/ssh/ca.pub
```
