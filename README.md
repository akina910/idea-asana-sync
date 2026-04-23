# idea-asana-sync

GitHub 上の idea repo を読み、Asana を入口一覧として更新する軽量同期ツール。

## 目的
- GitHub を正本のまま保つ
- Asana では「どんなアイディアがあるか」「ざっくり何か」だけ見えるようにする
- できるだけ自動で同期する

## 何をするか
- source repo の `status/project-index.md` を読む
- 各 idea のタイトル、要約、状態、次アクションを取得する
- Asana の 1 task = 1 idea で作成 / 更新する
- 既存 task の name / notes / section がすでに一致している場合は更新をスキップする
- source 側から消えた `[BI-xxx]` task や重複 task は project から外して入口一覧を正本に揃える
- task 本文に GitHub の `idea / notes / handoff` リンクを入れる
- `notes` / `handoff` が未作成の project は、壊れた GitHub リンクを出さず利用可能なリンクだけを入れる

## 何をしないか
- Asana を正本にしない
- 双方向同期しない
- 細かい実装管理を Asana でやらない

## 一番ラクな使い方
- この repo に GitHub Actions を置く
- source repo を別 checkout して読む
- 定期実行 + 手動実行で Asana を更新する

## 必要な Secrets / Variables

### 必須 Secrets
- `ASANA_ACCESS_TOKEN`
- `ASANA_PROJECT_URL`

### 任意 Secrets
- `ASANA_SECTION_NAME`
- `SOURCE_REPO_TOKEN`  
  source repo が private の時だけ使う

### 任意 Variables
- `SOURCE_REPOSITORY`  
  例: `yourname/your-idea-repo`
- `SOURCE_REPO_URL`  
  例: `https://github.com/yourname/your-idea-repo`
- `ASANA_USE_STATUS_SECTIONS`
  `true / 1 / yes / on`（大文字小文字は不問）のいずれかで `状態` 列を Asana section 名として自動作成 / 自動配置する
- GitHub Actions の `sync.yml` では `ASANA_USE_STATUS_SECTIONS` をデフォルト `true` で渡す
  - 旧運用（単一 section）に戻す場合は repo Variables または Secrets に `ASANA_USE_STATUS_SECTIONS=false` を設定する
- `ASANA_STATUS_SECTION_MAP_JSON`
  `ASANA_USE_STATUS_SECTIONS` 有効時のみ使用。状態名を任意の section 名へ寄せる JSON マップ
  例: `{"手動ローンチ実行待ち":"要対応","分離済み":"完了"}`

### Section設定の優先順位
- `ASANA_USE_STATUS_SECTIONS` が有効な場合は `ASANA_SECTION_NAME` を無視する（警告ログを出力）
- 状態が空の場合は `未分類` section に入る
- `ASANA_STATUS_SECTION_MAP_JSON` に該当があれば、その section 名を優先する

### 後方互換
- `BUSSINES_IDEA_REPOSITORY`
- `BUSSINES_IDEA_REPO_URL`
- `BUSSINES_IDEA_GITHUB_TOKEN`

## source repo の前提
- `status/project-index.md` がある
- `ideas/*.md` がある
- 各 idea file に `## 一言` セクションがある

`project-index.md` の table を正本として読む。

## 同期対象
- 名前
- 要約
- 状態
- タイプ
- 次アクション
- GitHub リンク

## ローカル確認
```bash
node sync-ideas-to-asana.mjs --dry-run
```

`.env.example` をコピーして値を入れると、ローカル実行のセットアップが早くできます。
`.env` は機密情報を含むため commit しないでください（`.env.example` のみ version 管理します）。

`ASANA_ACCESS_TOKEN` と `ASANA_PROJECT_URL` も渡すと、dry-run JSON に `reconciliation` が追加され、source 側に存在しない managed task や重複 managed task の削除候補も確認できます。
既存 task を取得できる環境では、各 idea に `_taskAction` (`created / updated / unchanged`) と `_sectionAction` (`assigned / moved / unchanged`) も出るため、本番実行前に差分の有無を確認できます。

Asana API の一覧取得はページネーション対応済みです。task や section が 100 件を超えても既存 task の重複作成を避けます。
また、source 側に存在しない task や重複 task を project から取り除くのは、このツールが管理していると判定できる task だけです。
定期実行時は差分がある task だけを更新し、すでに正しい section にいる task は再配置しません。
`project-index.md` の値が空・`-`・`—` などの placeholder の場合、Asana 本文には `未設定` として記録し、`undefined` が混入しないようにしています。

## 実反映
```bash
ASANA_ACCESS_TOKEN=... \
ASANA_PROJECT_URL=... \
SOURCE_REPO_PATH=/path/to/your/source-repo \
node sync-ideas-to-asana.mjs
```

## ライセンス
MIT
