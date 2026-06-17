# FINOLAB メンバー企業アシスタント（ローカルRAGアプリ）

FINOLABのメンバー企業について質問すると、登録済みデータを根拠に回答する目的特化型のチャットアプリです。
ベクトルDBやDifyは使わず、全社データをそのままClaude（Opus 4.8）のコンテキストに渡す「フルコンテキスト方式」で動作します。

## 構成（追加パッケージ不要）

```
app/
├─ server.mjs          … ローカルサーバー（APIキー保持＋Claude中継）。ゼロ依存
├─ members.json        … 構造化済みメンバー企業データ（ここを編集すれば回答が更新される）
├─ public/index.html   … チャット画面
├─ .env.example        … 設定ファイルのひな型
└─ README.md           … このファイル
```

## セットアップ（初回のみ）

### 1. Node.js をインストール
- https://nodejs.org/ja から **LTS版** をダウンロードしてインストール。
- インストール後、PowerShell を開き直して確認:
  ```powershell
  node --version
  ```
  `v20.x` のように表示されればOK。

### 2. APIキーを設定
1. https://console.anthropic.com でAPIキー（`sk-ant-...`）を発行。
2. `app` フォルダ内の `.env.example` をコピーして `.env` にリネーム。
3. `.env` を開き、`ANTHROPIC_API_KEY=` のあとに自分のキーを貼り付けて保存。

> ⚠️ `.env`（APIキー）は他人に共有しないでください。

## 起動

PowerShell で `app` フォルダに移動して実行:

```powershell
cd "C:\Users\tatsuyashirakawa\Desktop\Code\FINOLAB\app"
node server.mjs
```

`✅ FINOLAB RAG アプリ起動: http://localhost:8787` と表示されたら、
ブラウザで **http://localhost:8787** を開いてください。

停止するには PowerShell で `Ctrl + C`。

## データの追加・更新

`members.json` を編集して企業を追加・修正するだけで、次回起動時に回答へ反映されます。
（スキーマは [../FINOLAB_members.csv](../FINOLAB_members.csv) と同じ項目です）

## 仕組みのポイント

- **全社データをシステムプロンプトに同梱** し、`cache_control` でキャッシュ。2回目以降の入力コストは約1/10。
- 回答は登録データのみを根拠とし、データにない情報は「記載なし」と返すよう制約。
- 横断質問（「決済領域の企業は？」等）にも全データを走査して列挙。

## 公開（後日）

ローカルで満足したら、`server.mjs` をそのまま Vercel / Render / Cloudflare などに載せれば
URLで社内公開できます（APIキーは各サービスの環境変数に設定）。必要になったら相談してください。
