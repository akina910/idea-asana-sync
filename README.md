# idea-asana-sync

`bussines_idea` を読んで、Asana を入口一覧として更新する独立ツール。

## 目的
- `bussines_idea` の中で開発しない
- GitHub を正本のまま保つ
- Asana では「どんなアイディアがあるか」「ざっくり何か」だけ見えるようにする
- できるだけ自動で同期する

## 何をするか
- `bussines_idea/status/project-index.md` を読む
- 各 idea のタイトル、要約、状態、次アクションを取得する
- Asana の 1 task = 1 idea で作成 / 更新する
- task 本文に GitHub の `idea / notes / handoff` リンクを入れる

## 何をしないか
- Asana を正本にしない
- 双方向同期しない
- 細かい実装管理を Asana でやらない

## 一番ラクな使い方
- この repo に GitHub Actions を置く
- `bussines_idea` を別 checkout して読む
- 定期実行 + 手動実行で Asana を更新する

## 必要な Secrets

### 必須
- `ASANA_ACCESS_TOKEN`
- `ASANA_PROJECT_URL`

### 任意
- `ASANA_SECTION_NAME`
- `BUSSINES_IDEA_REPOSITORY`  
  既定: `akina910/bussines_idea`
- `BUSSINES_IDEA_REPO_URL`  
  既定: `https://github.com/akina910/bussines_idea`
- `BUSSINES_IDEA_GITHUB_TOKEN`  
  source repo が private の時だけ使う

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

## 実反映
```bash
ASANA_ACCESS_TOKEN=... \
ASANA_PROJECT_URL=... \
node sync-ideas-to-asana.mjs
```
