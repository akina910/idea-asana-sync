# BI-005 bussines_idea update proposal (2026-04-27)

`bussines_idea` は現セッションのサンドボックスで書き込み不可のため、反映用差分をここに残す。

## 1) handoff 追記案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 18. 2026-04-27 実装 — Asana API リトライ耐性の追加

### 実施内容
- `idea-asana-sync/sync-ideas-to-asana.mjs` に Asana API の再試行制御を追加
  - 対象: `429`, `500`, `502`, `503`, `504` と一時的なネットワーク例外
  - 方式: 指数バックオフ（`ASANA_API_RETRY_BASE_MS`） + 最大再試行回数（`ASANA_API_MAX_RETRIES`）
  - `Retry-After` ヘッダがある場合はその値を優先
- `createAsanaClient` をテストしやすい形に拡張（`fetchImpl` / `sleepImpl` 注入）
- `.env.example` と `README.md` に運用パラメータを追記
  - `ASANA_API_MAX_RETRIES`（デフォルト: `3`）
  - `ASANA_API_RETRY_BASE_MS`（デフォルト: `500`）
- `sync-ideas-to-asana.test.mjs` に 3 件追加（429再試行、ネットワーク例外再試行、400で再試行しない）
- `npm test` で 71 件すべて pass

### 判断理由
- BI-005 は新機能追加より運用安定性の価値が高い段階
- GitHub Actions の定期実行で一時的な Asana rate limit や短時間障害に耐えられるようにするのが、現時点の最も効果的な改善

### Cloudflare MCP 確認結果
- Internal 案件として Cloudflare MCP で Workers / D1 / KV の実リソース照会を試行したが、今回セッションでは 2 回とも `user cancelled MCP tool call` で取得不可
- BI-005 自体は Cloudflare 依存が必須ではないため、今回の作業は同期ツールの堅牢化を優先して継続
```

## 2) project-index 行更新案
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換前:

```md
【手動・残り1ステップ】Section分け実装済み。有効化: idea-asana-sync → Settings → Variables → ASANA_USE_STATUS_SECTIONS=true を追加するだけ。token rotate は2027-03頃
```

置換後:

```md
【自動化済み】Section分けは `ASANA_USE_STATUS_SECTIONS` 未設定でも有効（workflow既定値 `true` + スクリプト既定値 `true`）。【手動・任意】Asana 上の section 表示を確認し、必要なら `ASANA_STATUS_SECTION_MAP_JSON` を Variables/Secrets に追加。token rotate は2027-03頃
```
