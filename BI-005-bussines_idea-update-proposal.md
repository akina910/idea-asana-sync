# BI-005 bussines_idea update proposal (2026-04-25)

`bussines_idea` は現セッションのサンドボックスで書き込み不可のため、反映用差分をここに残す。

## 1) handoff 追記案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

末尾に追記:

```md
## 18. 2026-04-25 実装 — status section 正規化で運用ノイズを低減

### 実施内容
- `sync-ideas-to-asana.mjs` に `canonicalizeStatusForSection()` を追加し、status section 自動割当時に `・` `/` `｜` `|` 以降の補足を切り落として代表ラベル化するよう変更。
  - 例: `実装完了・デプロイ待ち` → `実装完了`
  - 例: `着手中（要確認）` → `着手中`
- `resolveTargetSectionName()` を更新し、`ASANA_STATUS_SECTION_MAP_JSON` を
  1) 生の status
  2) 正規化後 status
  の両方で照合するように変更。
- `sync-ideas-to-asana.test.mjs` に正規化ロジックの回帰テストを追加し、`npm test` 62件全通過を確認。
- `README.md` に section 化ルール（正規化 + map 優先順）を追記。

### 判断理由
- status に補足語が含まれる運用になると section が増殖し、Asana の入口一覧としての視認性が下がるため。
- 生 status と正規化 status の両方で map を引けるようにし、既存運用を壊さずに制御性を上げるため。

### Cloudflare MCP 確認結果
- `workers/scripts` / `d1/database` / `storage/kv/namespaces` / `r2/buckets` 照会を Cloudflare MCP で実行したが、いずれも `user cancelled MCP tool call` が返り取得できなかった。
- connector 側都合として記録し、次回オペレーション時に再照会する。

### いま人間がやること
- 【手動・任意】次回 sync 後に Asana 画面で section 名が意図どおりか目視確認する。
- 【手動・任意】必要なら `ASANA_STATUS_SECTION_MAP_JSON` を Variables/Secrets に追加して section 名を固定する。
- 【手動】Asana PAT ローテートは 2027-03 頃に実施する。
```

## 2) project-index 行更新案
対象: `bussines_idea/status/project-index.md` の BI-005 行 `次アクション`

置換前:

```md
【手動・残り1ステップ】Section分け実装済み。有効化: idea-asana-sync → Settings → Variables → ASANA_USE_STATUS_SECTIONS=true を追加するだけ。token rotate は2027-03頃
```

置換後:

```md
【自動化済み】Section分けは `ASANA_USE_STATUS_SECTIONS` デフォルト true のため追加設定なしで有効。status の補足（`・` 以降）や括弧注記は自動正規化して section 増殖を抑制済み。 【手動・任意】Asana で section 表示を確認し、必要なら `ASANA_STATUS_SECTION_MAP_JSON`（例: `{"手動ローンチ実行待ち":"要対応","実装完了":"リリース前"}`）を Variables/Secrets に追加。token rotate は2027-03頃
```
