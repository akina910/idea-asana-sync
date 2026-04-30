# BI-005 bussines_idea update proposal (2026-04-29)

`bussines_idea` は現セッションのサンドボックス制約で書き込み不可のため、反映用の追記・置換案をここに残す。

## 1) handoff 追記案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 19. 2026-04-29 実装 — source path 検証強化 + テスト拡張

### 実施内容
- `sync-ideas-to-asana.mjs` に `normalizeSourceRepoRelativePath()` を追加し、`idea/notes/handoff` パスを正規化・検証
- 許可プレフィックス（`ideas/` `notes/` `handoff/`）外、`..`/`.` セグメント、空セグメントを含む値を無効化
- `hydrateIdea` の source 読み込みを repo ルート内に制限し、無効パス時は warning + `project-index` 値へフォールバック
- `buildSourceRepoFileUrl` も同一正規化ロジックへ統一し、traversal 風パスのリンク化を防止
- `sync-ideas-to-asana.test.mjs` に5ケース追加（無効 `ideaPath`、パス正規化、traversal 警告）
- `README.md` に不正パス時のフォールバック挙動を追記
- `npm test` 実行結果: `81/81` pass
- `node sync-ideas-to-asana.mjs --dry-run` 実行成功

### 判断理由
- BI-005 は機能追加より運用安定性が優先の段階
- `project-index.md` の1セル誤記で読み込み対象が壊れると同期停止や意図しないリンク生成に繋がるため、入力検証を先に固める価値が高い

### Cloudflare MCP 確認結果
- Workers / D1 / KV / R2 の実リソース照会を試行したが、今回セッションではすべて `user cancelled MCP tool call` で取得不可
- BI-005 の主経路は GitHub Actions + Asana API のため、今回の作業は同期ロジックの堅牢化を優先

### レビューゲート状況
- Codex: 実装差分セルフレビュー実施
- Copilot: `copilot` / `gh copilot` とも `SecItemCopyMatching failed -50`。さらに `gh auth status` で token invalid のため実行不可
- Claude: CLI 未導入（`claude not found`）

### 次の一手（人間）
1. 【手動・最優先】GitHub/Copilot 認証復旧（例: `gh auth login -h github.com`）後、Copilot レビューを再実行
2. 【手動】Actions の `Sync Asana` を `workflow_dispatch` (`dry_run=false`) で1回実行し、Asana 側の section 反映を確認
```

## 2) handoff 追記案（今回分）
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 20. 2026-04-29 実装 — doctor モード + Actions 入力検査

### 実施内容
- `sync-ideas-to-asana.mjs` に `--doctor` モードを追加
- Asana を変更せず、source repo 読込件数、欠落 idea file、生成予定 section、Asana project GID 解決状況を JSON で出力できるようにした
- `package.json` に `npm run doctor` / `npm run dry-run` を追加
- GitHub Actions の `Sync Asana` に `Inspect sync inputs` step を追加し、本番 sync 前に `npm run doctor` が走るようにした
- `README.md` に doctor の用途を追記
- `sync-ideas-to-asana.test.mjs` に doctor report の単体テスト2件を追加

### 判断理由
- Section 分けは既にデフォルト有効化済みで、`ASANA_USE_STATUS_SECTIONS=true` の手動 variable 追加は不要になっている
- 残り価値は「本番同期前に source と section 生成予定を安全に確認できること」
- Asana API token がないローカル環境でも、source 側 68 件と section 予定を検証できるようにした

### 実行結果
- `npm test`: 83/83 pass
- `npm run doctor`: success。source 68件、missingIdeaFiles 0件、targetSections 13件
- `npm run dry-run`: success。Asana token/project 未設定のため reconciliation は unavailable
- `node --check sync-ideas-to-asana.mjs` / `node --check sync-ideas-to-asana.test.mjs`: pass

### Cloudflare MCP 確認結果
- Cloudflare API MCP の spec search と Workers/D1/KV/R2 照会を試行
- どちらも `user cancelled MCP tool call` で取得不可
- BI-005 の現行主経路は Cloudflare ではなく GitHub Actions + Asana API のため、追加 CF リソース作成は不要と判断

### レビューゲート状況
- Codex: 差分セルフレビュー実施。追加差分は doctor 出力のみで Asana mutation 経路に入らないことを確認
- Copilot: `copilot --help` / `gh copilot -p ...` が `SecItemCopyMatching failed -50` で失敗。`gh auth status` も token invalid
- Claude: CLI 未導入（`claude: command not found`）

### 次の一手（人間）
1. 【手動・最優先】GitHub/Copilot 認証復旧（`gh auth login -h github.com` 等）後、Copilot レビューを再実行
2. 【手動】Actions の `Sync Asana` を `workflow_dispatch` (`dry_run=false`) で1回実行し、Asana 側の section 反映を確認
```

## 3) project-index 行更新案（今回分）
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・残り2ステップ】①GitHub/Copilot 認証を復旧して Copilot レビューを実行（SecItemCopyMatching failed -50 / gh token invalid を解消）②Actions `Sync Asana` を workflow_dispatch (`dry_run=false`) で1回実行して Asana 側の section 反映を確認。status-section はデフォルト有効化済み、`npm run doctor` で source 68件・missing 0件・section予定13件を確認済み。token rotate は2027-03頃
```

## 4) handoff 追記案（今回分）
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 21. 2026-04-29 実装 — Markdown table の escaped pipe 対応

### 実施内容
- `sync-ideas-to-asana.mjs` の `parseIndexTable()` を単純な `split("|")` から `splitMarkdownTableRow()` ベースへ変更
- `project-index.md` の table cell 内で `\|` と書かれた pipe を列区切りではなく通常文字として扱うようにした
- `sync-ideas-to-asana.test.mjs` に escaped pipe を含む status / nextAction の回帰テストと helper 単体テストを追加
- `README.md` に table cell 内の `|` は `\|` と書けることを追記

### 判断理由
- BI-005 は既に Section 分けがデフォルト有効化済みで、価値の高い残作業は同期入力の壊れにくさを上げること
- 今後 `Codex \| Copilot \| Claude` のような記述が `project-index.md` に入った場合、旧実装だと列ズレで Asana の状態・次アクション・リンクが壊れる可能性があった

### 実行結果
- `npm test`: 87/87 pass
- `npm run doctor`: success。source 68件、missingIdeaFiles 0件、targetSections 13件
- `npm run dry-run`: success。Asana token/project 未設定のため reconciliation は unavailable
- `git diff --check`: pass

### Cloudflare MCP 確認結果
- Cloudflare API MCP で Workers / D1 / KV / R2 の照会を試行
- `user cancelled MCP tool call` で取得不可
- BI-005 の現行主経路は GitHub Actions + Asana API のため、Cloudflare リソース作成は不要と判断

### レビューゲート状況
- Codex: 差分セルフレビュー実施。parser 変更は table row 分割だけに限定され、既存の path 検証・Asana mutation 経路には影響しないことを確認
- Copilot: `copilot -p ...` / `gh copilot -p ...` とも `SecItemCopyMatching failed -50`。`gh auth status` も token invalid のため未通過
- Claude: CLI 未導入（`claude: command not found`）

### 次の一手（人間）
1. 【手動・最優先】GitHub/Copilot 認証復旧（`gh auth login -h github.com` 等）後、Copilot レビューを再実行
2. 【手動】Actions の `Sync Asana` を `workflow_dispatch` (`dry_run=false`) で1回実行し、Asana 側の section 反映を確認
```

## 5) project-index 行更新案（今回分）
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・残り2ステップ】①GitHub/Copilot 認証を復旧して Copilot レビューを実行（SecItemCopyMatching failed -50 / gh token invalid を解消）②Actions `Sync Asana` を workflow_dispatch (`dry_run=false`) で1回実行して Asana 側の section 反映を確認。status-section はデフォルト有効化済み、Markdown table の `\|` 対応・`npm run doctor` source 68件/missing 0件/section予定13件・`npm test` 87件 pass 確認済み。token rotate は2027-03頃
```

## 6) handoff 追記案（今回分）
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 22. 2026-04-30 実装 — strict doctor preflight

### 実施内容
- `sync-ideas-to-asana.mjs` に `--doctor --strict` を追加
- strict doctor では `ASANA_PROJECT_URL` 未設定/不正、または source 側 idea file 欠落時に non-zero exit で止める
- `package.json` に `npm run doctor:strict` を追加
- GitHub Actions の `Inspect sync inputs` step を `npm run doctor:strict` に変更し、本番 sync 前の入力不備を検出するようにした
- `README.md` に strict doctor の用途を追記
- `sync-ideas-to-asana.test.mjs` に strict doctor の failure 条件テスト2件を追加

### 判断理由
- Section 分けはデフォルト有効化済みで、残る価値は本番 sync 前に設定不備を確実に止めること
- 旧 preflight は invalid `ASANA_PROJECT_URL` を JSON に出すだけで workflow を失敗させず、同期直前の検査として弱かった

### 実行結果
- `npm test`: 89/89 pass
- `npm run doctor`: success。source 68件、missingIdeaFiles 0件、targetSections 13件
- `ASANA_PROJECT_URL=https://app.asana.com/0/1234567890123456/list npm run doctor:strict`: success
- `ASANA_PROJECT_URL` 未設定の `npm run doctor:strict`: exit 1 を確認
- `npm run dry-run`: success。Asana token/project 未設定のため reconciliation は unavailable
- `node --check sync-ideas-to-asana.mjs` / `node --check sync-ideas-to-asana.test.mjs` / `git diff --check`: pass

### Cloudflare 確認結果
- Cloudflare MCP tools はこのセッションで公開されておらず、`tool_search` でも該当ツールなし
- 代替で Wrangler 4.77.0 から Workers/D1/KV/R2 照会を試行したが、`Unable to resolve Cloudflare's API hostname` で取得不可
- BI-005 の現行主経路は GitHub Actions + Asana API のため、Cloudflare リソース作成は不要と判断

### レビューゲート状況
- Codex: 差分セルフレビュー実施。strict preflight は doctor 経路だけで Asana mutation 経路に入らないこと、CI では sync 前に不正入力を止めることを確認
- Copilot: `copilot --help` / `copilot -p ...` / `gh copilot suggest ...` がいずれも `SecItemCopyMatching failed -50`。`gh auth status` も token invalid のため未通過
- Claude: CLI 未導入（`claude: command not found`）

### 次の一手（人間）
1. 【手動・最優先】GitHub/Copilot 認証を復旧（`gh auth login -h github.com` 等）して Copilot レビューを再実行
2. 【手動】Actions の `Sync Asana` を `workflow_dispatch` (`dry_run=false`) で1回実行し、Asana 側の section 反映を確認
```

## 7) project-index 行更新案（今回分）
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・残り2ステップ】①GitHub/Copilot 認証を復旧して Copilot レビューを実行（SecItemCopyMatching failed -50 / gh token invalid を解消。今回の Copilot gate は未通過）②Actions `Sync Asana` を workflow_dispatch (`dry_run=false`) で1回実行して Asana 側の section 反映を確認。status-section はデフォルト有効化済み、strict preflight（`npm run doctor:strict`）追加済み、source 68件/missing 0件/section予定13件、`npm test` 89件 pass。token rotate は2027-03頃
```

## 8) handoff 追記案（今回分）
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 23. 2026-04-30 実装 — dry-run summary と Actions Step Summary

### 実施内容
- `sync-ideas-to-asana.mjs` に `summarizeDryRunOutput()` / `buildDryRunMarkdownSummary()` を追加
- `summarize-dry-run.mjs` を追加し、dry-run JSON を Markdown summary に変換できるようにした
- `package.json` に `npm run dry-run:summary` を追加
- GitHub Actions の `workflow_dispatch dry_run=true` 時は詳細 JSON をログへ直接出さず、作成/更新/移動/削除候補の集計を Step Summary に出すようにした
- README に dry-run summary の用途を追記
- 単体テストを3件追加

### 判断理由
- BI-005 は Section 分けがデフォルト有効化済みで、残る価値は本番反映直前の確認導線を安全にすること
- 既存の dry-run JSON は詳細すぎ、Actions ログでは確認しづらいため、手動実行時の判断に必要な件数と削除候補だけを要約するのが最も効果的

### 実行結果
- `npm test`: 92/92 pass
- `npm run doctor`: success。source 68件、missingIdeaFiles 0件、targetSections 13件
- `ASANA_PROJECT_URL=https://app.asana.com/0/1234567890123456/list npm run doctor:strict`: success
- `npm run dry-run:summary`: success。Asana token/project 未設定のため reconciliation は unavailable
- GitHub Actions dry-run branch 相当の一時ファイル経由 summary 生成: success
- `node --check sync-ideas-to-asana.mjs` / `node --check summarize-dry-run.mjs` / `git diff --check`: pass

### Cloudflare 確認結果
- Cloudflare MCP tools はこのセッションで公開されておらず、`tool_search` でも該当ツールなし
- 代替で Wrangler 4.77.0 から Workers/D1/KV/R2 照会を試行したが、`Unable to resolve Cloudflare's API hostname` で取得不可
- BI-005 の現行主経路は GitHub Actions + Asana API のため、Cloudflare リソース作成は不要と判断

### レビューゲート状況
- Codex: 差分セルフレビュー実施。dry-run summary は Asana mutation 経路に入らず、Actions の dry-run 分岐だけを変更することを確認
- Copilot: `copilot --help` / `copilot -p ...` / `gh copilot -p ...` が `SecItemCopyMatching failed -50` で失敗。`gh auth status` も token invalid のため未通過
- Claude: CLI 未導入（`claude: command not found`）

### 次の一手（人間）
1. 【手動・最優先】GitHub/Copilot 認証を復旧（`gh auth login -h github.com` 等）して Copilot レビューを再実行
2. 【手動】Actions の `Sync Asana` を `workflow_dispatch` (`dry_run=true`) で summary を確認後、`dry_run=false` で1回実行して Asana 側の section 反映を確認
```

## 9) project-index 行更新案（今回分）
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・残り2ステップ】①GitHub/Copilot 認証を復旧して Copilot レビューを実行（SecItemCopyMatching failed -50 / gh token invalid を解消。今回の Copilot gate は未通過）②Actions `Sync Asana` を workflow_dispatch (`dry_run=true`) で Step Summary を確認後、`dry_run=false` で1回実行して Asana 側の section 反映を確認。status-section はデフォルト有効化済み、dry-run summary/strict preflight 追加済み、source 68件/missing 0件/section予定13件、`npm test` 92件 pass。token rotate は2027-03頃
```
