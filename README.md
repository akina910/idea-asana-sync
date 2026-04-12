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
- task 本文に GitHub の `idea / notes / handoff` リンクを入れる

## 何をしないか
- Asana を正本にしない
- 双方向同期しない
- 細かい実装管理を Asana でやらない

## 一番ラクな使い方
- この repo に GitHub Actions を置く
- source repo を別 checkout して読む
- 定期実行 + 手動実行で Asana を更新する

## 必要な Secrets

### 必須
- `ASANA_ACCESS_TOKEN`
- `ASANA_PROJECT_URL`

### 任意
- `ASANA_SECTION_NAME`
- `ASANA_USE_STATUS_SECTIONS`  
  `"true"` にすると `状態` 列を Asana section 名として自動作成 / 自動配置する
- `SOURCE_REPOSITORY`  
  例: `yourname/your-idea-repo`
- `SOURCE_REPO_URL`  
  例: `https://github.com/yourname/your-idea-repo`
- `SOURCE_REPO_TOKEN`  
  source repo が private の時だけ使う

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

Asana API の一覧取得はページネーション対応済みです。task や section が 100 件を超えても既存 task の重複作成を避けます。

## 実反映
```bash
ASANA_ACCESS_TOKEN=... \
ASANA_PROJECT_URL=... \
SOURCE_REPO_PATH=/path/to/your/source-repo \
node sync-ideas-to-asana.mjs
```

## ライセンス
MIT
