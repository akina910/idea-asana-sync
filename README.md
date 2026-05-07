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
  `状態` 列を Asana section 名として自動作成 / 自動配置する。未設定時のデフォルトは `true`。
  明示的に無効化する場合のみ `false` / `0` / `no` / `off` などの非 truthy 値を指定する。
  認識できない値はデフォルト値（通常 `true`）にフォールバックする。
- `ASANA_STATUS_SECTION_MAP_JSON`
  `ASANA_USE_STATUS_SECTIONS` 有効時のみ使用。状態名を任意の section 名へ寄せる JSON マップ
  例: `{"手動ローンチ実行待ち":"要対応","分離済み":"完了"}`
  現在の source repo から section を粗く寄せる提案を出すには `npm run section-map:suggest` を実行する。
- `ASANA_API_MAX_RETRIES`
  Asana API の一時エラー（429/5xx/ネットワーク例外）に対するリトライ回数。`GET` / `PUT` のみ自動再試行。デフォルト `3`。
- `ASANA_API_RETRY_BASE_MS`
  リトライ時の初期待機ミリ秒。指数バックオフで使用。デフォルト `500`。
  `ASANA_API_MAX_RETRIES` / `ASANA_API_RETRY_BASE_MS` は `0` 以上の整数のみ受け付ける（例: `3`, `500`）。

補足:
- `ASANA_USE_STATUS_SECTIONS` は未設定でも `true` 扱いです。通常は Variables 追加なしで status-based section が有効です。
- `workflow_dispatch` 実行時は `dry_run=true` を選ぶと Asana を更新せず差分確認だけできます。

### Section設定の優先順位
- `ASANA_USE_STATUS_SECTIONS` は未設定でも有効（default true）
- `ASANA_USE_STATUS_SECTIONS` が有効な場合は `ASANA_SECTION_NAME` を無視する（警告ログを出力）
- 状態が空の場合は `未分類` section に入る
- status 文字列に `・` `/` `｜` `|` が含まれる場合は先頭トークンを代表ラベルとして section 化する（例: `実装完了・デプロイ待ち` → `実装完了`）
- `ASANA_STATUS_SECTION_MAP_JSON` は「生の status」と「代表ラベル」の両方で照合し、該当があればその section 名を優先する
- section 名が 80 文字を超える場合は自動で切り詰める（末尾 `…`）

### 後方互換
- `BUSSINES_IDEA_REPOSITORY`
- `BUSSINES_IDEA_REPO_URL`
- `BUSSINES_IDEA_GITHUB_TOKEN`

## source repo の前提
- `status/project-index.md` がある
- `ideas/*.md` がある
- 各 idea file に `## 一言` セクションがある

`project-index.md` の table を正本として読む。
table cell 内で `|` を使う場合は Markdown として `\|` と書くと、同期時は通常の `|` として扱う。

## 同期対象
- 名前
- 要約
- 状態
- タイプ
- 次アクション
- GitHub リンク

## ローカル確認
```bash
npm run doctor
npm run doctor:strict
npm run section-map:suggest
npm run dry-run
npm run dry-run:summary
node sync-ideas-to-asana.mjs --dry-run
```

`.env.example` をコピーして値を入れると、ローカル実行のセットアップが早くできます。
`.env` は機密情報を含むため commit しないでください（`.env.example` のみ version 管理します）。

`npm run doctor` は Asana を変更せず、source repo の読込件数、欠落 idea file、生成予定 section、`ASANA_PROJECT_URL` から解決した project GID を JSON で確認します。
`npm run doctor:strict` は CI / 本番同期前の preflight 用です。`ASANA_ACCESS_TOKEN` / `ASANA_PROJECT_URL` が未設定、`ASANA_PROJECT_URL` が不正、`ASANA_USE_STATUS_SECTIONS` が typo などで true/false 系として解釈できない、もしくは source 側の idea file が欠落している場合は non-zero exit で止めます。
`npm run section-map:suggest` は Asana を変更せず、現在の status 値を `着手中` / `実装完了` / `分離済み` / `手動待ち` などへ寄せる `ASANA_STATUS_SECTION_MAP_JSON` の候補を出します。section が増えすぎた時は `asanaStatusSectionMapJson` の値を GitHub Actions Variables に貼るだけで調整できます。

`ASANA_ACCESS_TOKEN` と `ASANA_PROJECT_URL` も渡すと、dry-run JSON に `reconciliation` が追加され、source 側に存在しない managed task や重複 managed task の削除候補も確認できます。
既存 task を取得できる環境では、各 idea に `_taskAction` (`created / updated / unchanged`) と `_sectionAction` (`assigned / moved / unchanged`) も出るため、本番実行前に差分の有無を確認できます。
`npm run dry-run:summary` は詳細 JSON を Markdown の要約に変換し、作成/更新/移動/削除候補の件数だけを確認できます。GitHub Actions の `workflow_dispatch` で `dry_run=true` を選んだ場合も、この summary を Step Summary に出します。

Asana API の一覧取得はページネーション対応済みです。task や section が 100 件を超えても既存 task の重複作成を避けます。
また、source 側に存在しない task や重複 task を project から取り除くのは、このツールが管理していると判定できる task だけです。
定期実行時は差分がある task だけを更新し、すでに正しい section にいる task は再配置しません。
`project-index.md` の値が空・`-`・`—` などの placeholder の場合、Asana 本文には `未設定` として記録し、`undefined` が混入しないようにしています。
`idea / notes / handoff` のパスは `ideas/` `notes/` `handoff/` 配下のみを許可し、`..` を含む不正パスは読み込み・リンク化せず warning を出して row 側の値へフォールバックします。

## 実反映
```bash
ASANA_ACCESS_TOKEN=... \
ASANA_PROJECT_URL=... \
SOURCE_REPO_PATH=/path/to/your/source-repo \
node sync-ideas-to-asana.mjs
```

## GitHub Actions での安全運用
- `workflow_dispatch` の `dry_run=true`: Asana を更新せず同期差分だけ検証
- `workflow_dispatch` の `dry_run=false` または schedule/repository_dispatch: 実反映
- 実行前に毎回 `npm test` と `npm run doctor:strict` が走るため、基本的な回帰と入力不備は workflow 側で検知できます

## ライセンス
MIT
