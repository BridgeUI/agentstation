# Claude Code の設定断片

`settings.fragment.json` を各環境の `~/.claude/settings.json` にマージする（docs/spec.md 7章）。

- `env.DISABLE_AUTOUPDATER = "1"`：裏の自動更新を止める。手動の `claude update`（夜間メンテナンスでエージェントが実行）は使える
- `autoUpdatesChannel = "stable"`

## マージ手順（既存の設定を壊さない）

既存の `~/.claude/settings.json` が無ければ、そのままコピーする：

```bash
mkdir -p ~/.claude
test -f ~/.claude/settings.json || cp settings.fragment.json ~/.claude/settings.json
```

既にある場合は、Node（nodebrew で導入済み）で深いマージをする。`env` の他のキーは残り、断片のキーだけが上書きされる：

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const m={...a,...b,env:{...(a.env||{}),...(b.env||{})}};fs.writeFileSync(process.argv[1],JSON.stringify(m,null,2)+"\n")' ~/.claude/settings.json settings.fragment.json
```

確認：

```bash
node -e 'const s=JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"));console.log(s.env&&s.env.DISABLE_AUTOUPDATER, s.autoUpdatesChannel)'
```

期待する結果：`1 stable`。

`jq` が入っていれば `jq -s '.[0] * .[1]' ~/.claude/settings.json settings.fragment.json` でも同じ（`*` は再帰マージ）。

設定を変えたあとは `launchctl kickstart -k gui/$(id -u)/com.example.claude-rc` で Remote Control を起動し直す。
