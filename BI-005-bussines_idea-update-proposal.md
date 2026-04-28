# BI-005 bussines_idea update proposal (2026-04-28)

`bussines_idea` は現セッションのサンドボックス制約で書き込み不可のため、反映用の追記・置換案をここに残す。

## 1) handoff 追記案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 18. 2026-04-28 実装 — 設定値パースの堅牢化

### 実施内容
- `sync-ideas-to-asana.mjs` の設定値パースを強化
  - `parseBooleanFlag`: `true/1/yes/on` と `false/0/no/off` を明示解釈
  - 未知の値（例: `treu`）は誤って無効化せず、デフォルト値へフォールバック
  - `parseNonNegativeInteger`: `parseInt` の部分一致受理を廃止し、`0` 以上の整数のみ受理（例: `7ms` はエラー）
- `sync-ideas-to-asana.test.mjs` に上記ケースのテストを追加
- `README.md` に「未知の boolean 値はデフォルトへフォールバック」「retry 数値は整数のみ」の仕様を追記
- `npm test` 実行結果: `76/76` pass

### 判断理由
- BI-005 は機能追加より運用安定性が優先の段階
- GitHub Actions Variables/Secrets の typo による意図しない挙動変更を防ぐほうが価値が高い

### Cloudflare MCP 確認結果
- Workers / D1 / KV の実リソース照会を試行したが、今回セッションではすべて `user cancelled MCP tool call` で取得不可
- BI-005 の主経路は GitHub Actions + Asana API のため、今回の作業は同期ロジックの堅牢化を優先

### レビューゲート状況
- Codex: 実装差分セルフレビュー実施
- Copilot: CLI は存在するが `SecItemCopyMatching failed -50` で起動不可（レビュー実行不可）
- Claude: CLI 未導入（`claude not found`）
```

## 2) project-index 行更新案
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換後:

```md
【手動・確認のみ】status-section は既定で有効化済み（追加設定不要）。GitHub Actions の workflow_dispatch で `dry_run=true` を1回実行して section 差分を確認し、その後 `dry_run=false` で1回実同期する。必要なら `ASANA_STATUS_SECTION_MAP_JSON` を追加。token rotate は2027-03頃
```
