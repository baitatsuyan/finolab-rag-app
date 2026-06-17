// FINOLAB メンバー企業 RAG アプリ（ゼロ依存・ローカル実行）
// Node.js 18+ で動作。外部パッケージのインストールは不要です。
//
// 使い方:
//   1. 同じフォルダに .env を作成し  ANTHROPIC_API_KEY=sk-ant-...  を記載
//   2. node server.mjs
//   3. ブラウザで http://localhost:8787 を開く

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const MODEL = "claude-opus-4-8";

// ---- 公開運用向けの簡易ガード（任意の合言葉 + レート制限）-------------------
// ACCESS_PASSWORD を設定すると「合言葉を知っている人だけ」モードになる。
// 未設定（空）なら URL を知っている人は誰でも使える完全公開モード。
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 15); // 1IPあたり/分
const MAX_DAILY_REQUESTS = Number(process.env.MAX_DAILY_REQUESTS || 2000); // 全体/日（暴走・予算超過の保険）

const ipHits = new Map(); // ip -> 直近のアクセス時刻(ms)の配列
let dayKey = new Date().toISOString().slice(0, 10);
let dayCount = 0;

function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return xff || req.socket.remoteAddress || "unknown";
}

function checkPassword(req) {
  if (!ACCESS_PASSWORD) return true;
  return req.headers["x-access-password"] === ACCESS_PASSWORD;
}

function checkRate(req) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= MAX_DAILY_REQUESTS) return { ok: false, reason: "daily" };

  const ip = clientIp(req);
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE_PER_MIN) return { ok: false, reason: "permin" };
  arr.push(now);
  ipHits.set(ip, arr);
  dayCount++;
  return { ok: true };
}

// ---- .env を簡易ロード（dotenv不要）---------------------------------------
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("\n[エラー] ANTHROPIC_API_KEY が設定されていません。");
  console.error("  app/.env に  ANTHROPIC_API_KEY=sk-ant-...  を記載してください。\n");
  process.exit(1);
}

// ---- メンバー企業データ → ナレッジベース文字列 ----------------------------
const members = JSON.parse(readFileSync(join(__dirname, "members.json"), "utf8"));

function memberToText(m, idx) {
  const lines = [`### ${idx + 1}. ${m["企業名"]}（${m["メンバー区分"]}）`];
  for (const [k, v] of Object.entries(m)) {
    if (k === "企業名" || k === "メンバー区分") continue;
    const label = k.replace(/_/g, "（") + (k.includes("_") ? "）" : "");
    const val = Array.isArray(v) ? v.join("、") : v;
    if (val && val !== "不明") lines.push(`- ${label}: ${val}`);
  }
  return lines.join("\n");
}

const KNOWLEDGE_BASE = members.map(memberToText).join("\n\n");

const SYSTEM_PROMPT = `あなたは「FINOLAB（フィノラボ）」入居・メンバー企業に関する質問に答える、目的特化型のアシスタントです。

# 役割と制約
- 以下の【メンバー企業データベース】に記載された情報のみを根拠に回答してください。
- データベースにない情報は推測せず、「提供データには記載がありません」と明示してください。
- 回答の根拠とした企業名・項目を明示し、出典が追えるようにしてください。
- FINOLABメンバー企業と無関係な質問（一般常識・雑談・他社比較で根拠のないもの等）には、本アシスタントの目的外であることを丁寧に伝えてください。
- 「決済領域の企業を挙げて」「資金移動業ライセンスを持つ会社は？」のような横断的な質問には、データベース全体を確認して該当する企業を漏れなく列挙してください。
- 各項目に「不明」「未取得」とある場合は、その情報が現時点で未収集であることを伝えてください（事実として存在しないと断定しないこと）。
- 回答は簡潔に、要点から先に述べてください。前置きや内部の思考過程は出力しないでください。

# データの現状
現在、FINOLABのメンバー企業 ${members.length}社分のデータが登録されています（スタートアップ・大手企業・団体を含む、メンバーページ掲載分を概ね網羅）。質問された企業がデータベースに無い場合は、「まだ登録されていない可能性がある」旨を案内してください。また各項目に「不明」「未取得」「要確認」とある場合は、その情報が未収集または要確認であることを正確に伝えてください。

# メンバー企業データベース
${KNOWLEDGE_BASE}`;

// ---- Anthropic Messages API（ストリーミング）を中継 ------------------------
async function handleChat(req, res) {
  // 合言葉ゲート（ACCESS_PASSWORD 設定時のみ有効）
  if (!checkPassword(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "合言葉が必要です。", needPassword: true }));
    return;
  }
  // レート制限
  const rate = checkRate(req);
  if (!rate.ok) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          rate.reason === "daily"
            ? "本日の利用回数の上限に達しました。時間をおいて再度お試しください。"
            : "アクセスが集中しています。少し時間をおいて再度お試しください。",
      })
    );
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let messages;
  try {
    messages = JSON.parse(body).messages;
    if (!Array.isArray(messages)) throw new Error("messages must be an array");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid request body" }));
    return;
  }

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      stream: true,
      // 大きく安定したデータ部分をプロンプトキャッシュ（2回目以降の入力コストが約1/10）
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    }),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    res.writeHead(apiRes.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: errText }));
    return;
  }

  // Anthropic の SSE を解釈し、テキスト差分だけをプレーンテキストでブラウザへ流す
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });

  const reader = apiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
            res.write(parsed.delta.text);
          }
        } catch {
          /* 部分的なJSONは無視 */
        }
      }
    }
  }
  res.end();
}

// ---- 静的ファイル配信 + ルーティング --------------------------------------
const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      await handleChat(req, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try {
      const html = await readFile(join(__dirname, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("index.html not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n✅ FINOLAB RAG アプリ起動: http://localhost:${PORT}`);
  console.log(`   登録企業数: ${members.length}社`);
  console.log(`   使用モデル: ${MODEL}`);
  console.log(`   アクセス制限: ${ACCESS_PASSWORD ? "合言葉あり（限定公開）" : "なし（完全公開）"}` +
    ` / レート ${RATE_PER_MIN}回・分・IP / 1日上限 ${MAX_DAILY_REQUESTS}回`);
  console.log(`   停止するには Ctrl+C\n`);
});
