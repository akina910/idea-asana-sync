# BI-005 bussines_idea update proposal (2026-04-24)

## 1) handoff 追記案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

```md
## 18. 2026-04-24 実装 — Section 名の安全化（長すぎる状態値対策）

### 背景
- `ASANA_USE_STATUS_SECTIONS=true` で `status/project-index.md` の `状態` 列をそのまま Section 名に使うため、将来 `状態` が長文化した場合に Asana 側制約で API エラーになるリスクがある。

### 実施内容
- `idea-asana-sync/sync-ideas-to-asana.mjs`
  - `ASANA_SECTION_NAME_MAX_LEN = 80` を追加
  - `normalizeSectionName()` で 80 文字超の Section 名を `…` 付きで自動切り詰め
  - `resolveTargetSectionName()` の返却値を必ず `normalizeSectionName()` 経由に統一（status 由来 / map 由来 / 固定 section すべて）
- `idea-asana-sync/sync-ideas-to-asana.test.mjs`
  - `normalizeSectionName` の長文切り詰めテストを追加
  - `resolveTargetSectionName` の長文 status 切り詰めテストを追加
- `idea-asana-sync/README.md`
  - 「Section 名が 80 文字を超える場合は自動切り詰め」の仕様を追記

### 検証
- `npm test` 実行: 57 tests / 57 pass

### Cloudflare MCP 確認
- `workers/scripts` 取得を 2 回試行したが、いずれも `user cancelled MCP tool call` で取得不能。
- 本プロジェクトは Cloudflare リソース前提ではなく GitHub Actions + Asana API 運用のため、実装継続を優先。

### 次の一手（人間）
- `idea-asana-sync` の Actions から `Sync Asana` を `workflow_dispatch` で 1 回実行し、Section 自動分けが想定どおり反映されることだけ確認する。
```

## 2) project-index 行更新案
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換前:
```md
【手動・残り1ステップ】Section分け実装済み。有効化: idea-asana-sync → Settings → Variables → ASANA_USE_STATUS_SECTIONS=true を追加するだけ。token rotate は2027-03頃
```

置換後:
```md
【手動・最優先】idea-asana-sync → Actions → Sync Asana を workflow_dispatch で1回実行し、状態ベースSection作成/移動が想定どおり反映されることを確認する（Section名80文字超は自動切り詰め実装済み）。固定Section運用へ戻す場合のみ `ASANA_USE_STATUS_SECTIONS=false` を設定。token rotate は2027-03頃
```
