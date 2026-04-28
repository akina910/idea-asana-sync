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

## 2) project-index 行更新案
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・残り2ステップ】①GitHub/Copilot 認証を復旧して Copilot レビューを実行（SecItemCopyMatching failed -50 / token invalid を解消）②Actions `Sync Asana` を workflow_dispatch (`dry_run=false`) で1回実行して section 反映を確認。status-section 実装とテスト（81/81 pass）は完了済み。token rotate は2027-03頃
```
