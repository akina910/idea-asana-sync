# BI-005 bussines_idea update proposal (2026-04-25)

`bussines_idea` は現セッションのサンドボックスで書き込み不可のため、反映用差分をここに残す。

## 1) handoff 更新案
対象: `bussines_idea/handoff/BI-005-asana-idea-sync-handoff.md`

### A. 既存セクションの置換
次のブロックを置換:

```md
### 有効化手順（人間がやること）
1. `idea-asana-sync` repo の Settings → Variables → Actions で `ASANA_USE_STATUS_SECTIONS = true` を追加する
2. 次の sync 実行で、各プロジェクトの状態値（着手中・分離済み・完了など）がそのまま Section 名になる
3. `ASANA_SECTION_NAME` secret は残したまま or 削除してもよい
```

置換後:

```md
### 有効化手順（自動化済み）
1. 追加の Variables 設定は不要。`ASANA_USE_STATUS_SECTIONS` は未設定でもデフォルト有効。
2. 次の sync 実行で、各プロジェクトの状態値（着手中・分離済み・完了など）がそのまま Section 名になる。
3. 旧運用（単一 section）に戻す場合のみ `ASANA_USE_STATUS_SECTIONS=false` を設定する。
```

### B. 追記セクション
末尾に追記:

```md
## 18. 2026-04-25 実装 — status section 既定ON化と文書整合

### 実施内容
- `sync-ideas-to-asana.mjs` の `parseBooleanFlag` に `defaultValue` オプションを追加し、`loadConfig` の `ASANA_USE_STATUS_SECTIONS` は未設定時 `true` になるよう変更。
- `sync-ideas-to-asana.test.mjs` に「未設定値で defaultValue を使う」ケースを追加し、`npm test` 58件全通過を確認。
- `.env.example` と `README.md` を更新し、status section の有効化が手動変数追加なしで動くことを明記。
- `node sync-ideas-to-asana.mjs --dry-run` で `_section` が status 由来（例: `着手中`）になることを再確認。

### 判断理由
- 「残り1ステップ（Variables追加）」が実運用上の不要手順になっていたため、コード既定値を合わせて人間作業を削減。
- 設定漏れで section 分けが無効になる事故を防止。

### Cloudflare MCP 確認結果
- `workers/scripts` / `d1/database` / `storage/kv/namespaces` の照会を Cloudflare MCP で実行したが、3回とも `user cancelled MCP tool call` で取得不可。
- connector 側都合として記録し、次回オペレーション時に再照会する。

### いま人間がやること
- 【手動】次回の sync 実行後に Asana 画面で status 別 section 配置を目視確認する（設定追加は不要）。
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
【手動・確認のみ】`idea-asana-sync` の Sync Asana 実行後、Asanaで status ベースSection（着手中/分離済み/完了など）が反映されることを目視確認する。`ASANA_USE_STATUS_SECTIONS` の追加設定は不要（未設定でも既定ON）。固定Sectionへ戻す場合のみ `ASANA_USE_STATUS_SECTIONS=false` を設定。token rotate は2027-03頃
```
