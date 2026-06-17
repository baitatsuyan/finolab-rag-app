# Render へのデプロイ手順（完全公開・誰でもURLで利用可）

このアプリを Render に載せて、URLを知っている人なら誰でも使える状態にする手順です。
所要時間は10〜15分ほど。**APIキーはGitHubには載せず、Renderの画面で安全に入力します。**

---

## 事前準備（アカウント）

- GitHub アカウント … https://github.com
- Render アカウント … https://render.com （GitHubでサインアップ可）

---

## ステップ1：`app` フォルダを GitHub リポジトリにする

PowerShell で **app フォルダ** に入り、Gitリポジトリ化して push します。

```powershell
cd "C:\Users\tatsuyashirakawa\Desktop\Code\FINOLAB\app"
git init
git add .
git status   # ← ここで .env が一覧に出ていないことを必ず確認（出ていたら止める）
git commit -m "FINOLAB RAG app"
git branch -M main
```

> ⚠️ `git status` の一覧に **.env が含まれていないこと** を必ず確認してください（`.gitignore`で除外済みですが念のため）。APIキーの流出を防ぐためです。

次に GitHub で空のリポジトリを作成し（例：`finolab-rag-app`、Public/Privateどちらでも可）、表示される手順の「push an existing repository」に従って接続・pushします。

```powershell
git remote add origin https://github.com/<あなたのユーザー名>/finolab-rag-app.git
git push -u origin main
```

（初回は GitHub のログイン画面が出ます。指示に従ってログインしてください。）

---

## ステップ2：Render でデプロイ

### 方法A：Blueprint（render.yaml を使う・おすすめ）

1. Render ダッシュボード → **New +** → **Blueprint**
2. 先ほどの GitHub リポジトリを選択 → Render が `render.yaml` を読み込み、自動で設定
3. **ANTHROPIC_API_KEY** の入力を求められるので、`sk-ant-...` を貼り付け
4. **Apply / Deploy** をクリック

### 方法B：手動（Web Service を自分で作る）

1. Render ダッシュボード → **New +** → **Web Service**
2. GitHub リポジトリを選択
3. 設定：
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. **Environment** に環境変数を追加：
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
5. **Create Web Service**

---

## ステップ3：公開URLを確認

デプロイが完了すると、`https://finolab-rag-app.onrender.com` のような **公開URL** が発行されます。
このURLを共有すれば、誰でもブラウザでアクセスして利用できます。

---

## 運用メモ

- **無料プランの仕様**：15分アクセスが無いとスリープし、次の初回アクセスだけ起動に30〜60秒かかります（その後は通常速度）。常時起動が必要なら有料プラン（Starter）に変更できます。
- **コスト保護**：レート制限（1IP 15回/分）と1日の総回数上限（既定2000回）が入っています。Renderの環境変数 `RATE_PER_MIN` / `MAX_DAILY_REQUESTS` で調整可能。
- **後から「合言葉モード」にしたい場合**：Renderの環境変数に `ACCESS_PASSWORD` を追加するだけで、URL＋合言葉を知っている人だけが使える限定公開に切り替わります（再デプロイ不要、再起動で反映）。
- **データ更新**：`members.json` を編集して `git add . && git commit -m "update" && git push` すると、Renderが自動で再デプロイします。

---

## トラブル時

- デプロイが失敗する → Render の **Logs** を確認。`ANTHROPIC_API_KEY が設定されていません` と出ていれば環境変数の入力漏れです。
- 画面は出るが回答が「エラー」になる → APIキーが正しいか、Anthropicの残高があるかを確認。
- 困ったらログ画面の内容を貼ってください。
