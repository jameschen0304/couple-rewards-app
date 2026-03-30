import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { readFileSync } from "fs";

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
console.log("[couple-rewards-proxy] boot", { PORT: process.env.PORT, listen: PORT, HOST });

function createDb() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    if (json && String(json).trim()) {
      const parsed = JSON.parse(String(json).trim());
      if (admin.apps.length === 0) {
        admin.initializeApp({ credential: admin.credential.cert(parsed) });
      }
      return admin.firestore();
    }
    if (credPath) {
      const raw = readFileSync(credPath, "utf8");
      const parsed = JSON.parse(raw);
      if (admin.apps.length === 0) {
        admin.initializeApp({ credential: admin.credential.cert(parsed) });
      }
      return admin.firestore();
    }
    console.error(
      "[couple-rewards-proxy] Missing FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS"
    );
    return null;
  } catch (e) {
    console.error("[couple-rewards-proxy] Firebase init failed:", e.message);
    return null;
  }
}

const db = createDb();

function validLedgerId(id) {
  return typeof id === "string" && /^[a-f0-9]{24}$/.test(id);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function requireGeminiKey(res) {
  if (!GEMINI_API_KEY || !String(GEMINI_API_KEY).trim()) {
    res.status(503).json({ error: "Missing GEMINI_API_KEY in server-proxy env" });
    return false;
  }
  return true;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const texts = parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).filter(Boolean);
  if (texts.length === 0) return null;
  return texts.join("").trim();
}

async function geminiGenerateText({ model, systemInstruction, userPrompt }) {
  const m = model || GEMINI_MODEL;
  const system = systemInstruction || "";
  const userText = userPrompt || "";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  const payload = {
    systemInstruction: system
      ? { role: "system", parts: [{ text: system }] }
      : undefined,
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 420,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (data && (data.error?.message || data.error?.status)) || String(r.statusText || "gemini request failed");
    const err = new Error(msg);
    err.status = r.status;
    err.payload = data;
    throw err;
  }

  const text = extractGeminiText(data);
  if (!text) throw new Error("Gemini returned empty text");
  return text;
}

function checkSecret(req, res) {
  const need = process.env.PROXY_SHARED_SECRET;
  if (!need) return true;
  const q = String(req.query.s || "");
  const h = String(req.get("X-Proxy-Secret") || "");
  if (q === need || h === need) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_, res) => {
  if (!db) {
    return res.status(503).json({
      ok: false,
      firestore: false,
      error:
        "Firestore not configured: set valid FIREBASE_SERVICE_ACCOUNT_JSON in Railway Variables (full service account JSON)",
    });
  }
  res.json({
    ok: true,
    firestore: true,
    geminiApiKeyConfigured: Boolean(GEMINI_API_KEY && String(GEMINI_API_KEY).trim()),
  });
});

async function verifyIdTokenFromRequest(req, res) {
  if (!requireDb(res)) return null;
  const authHeader = req.get("Authorization") || "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const q = req.query.token || req.query.t;
  const token = m ? m[1].trim() : String(q || "").trim();
  if (!token) {
    res.status(401).json({ error: "missing token" });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (e) {
    console.error("verifyIdToken", e.message);
    res.status(401).json({ error: "invalid token" });
    return null;
  }
}

app.get("/v1/me", async (req, res) => {
  const user = await verifyIdTokenFromRequest(req, res);
  if (!user) return;
  try {
    const snap = await db.collection("users").doc(user.uid).get();
    if (!snap.exists) return res.json({ exists: false });
    const v = snap.data() || {};
    return res.json({ exists: true, data: v.data ?? null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/v1/me", async (req, res) => {
  const user = await verifyIdTokenFromRequest(req, res);
  if (!user) return;
  const { data, merge } = req.body || {};
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "body.data required" });
  }
  const useMerge = merge === true || req.query.merge === "1";
  try {
    const ref = db.collection("users").doc(user.uid);
    const payload = {
      data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (useMerge) await ref.set(payload, { merge: true });
    else await ref.set(payload);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/v1/me/stream", async (req, res) => {
  const user = await verifyIdTokenFromRequest(req, res);
  if (!user) return;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const ref = db.collection("users").doc(user.uid);
  const unsub = ref.onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const v = snap.data();
      if (!v || v.data == null) return;
      res.write(`data: ${JSON.stringify({ data: v.data })}\n\n`);
    },
    (err) => {
      console.error("users onSnapshot", err);
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: String(err.message || err) })}\n\n`
        );
      } catch (_) {}
    }
  );

  const hb = setInterval(() => {
    try {
      res.write(":hb\n\n");
    } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(hb);
    unsub();
  });
});

function requireDb(res) {
  if (!db) {
    res.status(503).json({
      error:
        "Firestore unavailable: fix FIREBASE_SERVICE_ACCOUNT_JSON in Railway Variables (valid JSON, full service account key)",
    });
    return false;
  }
  return true;
}

app.post("/v1/ai/anger/nvc", async (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!requireGeminiKey(res)) return;

  const body = req.body || {};
  const wifeName = typeof body.wifeName === "string" && body.wifeName.trim() ? body.wifeName.trim().slice(0, 16) : "老婆";
  const obs = typeof body.obs === "string" ? body.obs : "";
  const feel = typeof body.feel === "string" ? body.feel : "";
  const need = typeof body.need === "string" ? body.need : "";
  const requestText = typeof body.request === "string" ? body.request : "";
  const issueType = typeof body.issueType === "string" ? body.issueType : "";

  const systemInstruction =
    "你是一个擅长伴侣沟通的助手，指导使用非暴力沟通（NVC）。\n" +
    "输出要求：只给中文话术，不要解释过程；语气温柔、真诚、不指责、不贴标签；尽量简短清晰（5-10 句）；避免任何可能升级冲突的内容。";

  const userPrompt =
    `请根据以下信息生成一段 NVC 话术，适合在吵架时直接读给对方听。` +
    `\n\n` +
    `对方称呼：${wifeName}` +
    `\n观察（事实）obs：${obs || "（未填写）"}` +
    `\n感受（我此刻的情绪）feel：${feel || "（未填写）"}` +
    `\n需要（我需要什么）need：${need || "（未填写）"}` +
    `\n请求（我希望你做什么）request：${requestText || "（未填写）"}` +
    `\n问题类型 issueType：${issueType || "other"}` +
    `\n\n` +
    `话术结构建议：\n` +
    `1）先感谢/肯定对方愿意说\n` +
    `2）复述观察（不带责怪）\n` +
    `3）表达感受\n` +
    `4）说出需要\n` +
    `5）给出一个具体请求（尽量可执行）\n` +
    `6）最后用一句温和的提问确认下一步`;

  try {
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : GEMINI_MODEL;
    const text = await geminiGenerateText({ model, systemInstruction, userPrompt });
    res.json({ ok: true, text });
  } catch (e) {
    console.error("[ai nvc]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/v1/ai/anger/dialogue", async (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!requireGeminiKey(res)) return;

  const body = req.body || {};
  const wifeName = typeof body.wifeName === "string" && body.wifeName.trim() ? body.wifeName.trim().slice(0, 16) : "老婆";
  const issueType = typeof body.issueType === "string" ? body.issueType : "other";
  const concern = typeof body.concern === "string" ? body.concern : "";
  const desired = typeof body.desired === "string" ? body.desired : "";

  const systemInstruction =
    "你是一个擅长关键对话（Key Dialogue）与关系修复的助手。\n" +
    "输出要求：只给中文可直接使用的方案；语气温柔、不评判、不煽动对抗；以“把问题变成下一步”为核心；结构清晰（不超过 12 句/要点）；最后一定包含一个邀请对方一起选小行动的问题。";

  const userPrompt =
    `请生成一段“关键对话方案”，用于把这次争执落到可执行的下一步。` +
    `\n\n` +
    `对方称呼：${wifeName}` +
    `\n问题类型：${issueType}` +
    `\n我真正担心的是什么 concern：${concern || "（未填写）"}` +
    `\n我希望达成的结果 desired：${desired || "（未填写）"}` +
    `\n\n` +
    `建议包含：` +
    `\n- 1 句温和开场（认可对方情绪/愿意沟通）` +
    `\n- 1-2 句把担心与目标说清楚（不指责）` +
    `\n- 给 2-3 个“今晚/明天的小行动”选项（每个选项一句）` +
    `\n- 最后问对方“你更愿意先选哪一个作为第一步？”`;

  try {
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : GEMINI_MODEL;
    const text = await geminiGenerateText({ model, systemInstruction, userPrompt });
    res.json({ ok: true, text });
  } catch (e) {
    console.error("[ai dialogue]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/v1/ai/anger/joke", async (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!requireGeminiKey(res)) return;

  const body = req.body || {};
  const issueType = typeof body.issueType === "string" ? body.issueType : "other";
  const concern = typeof body.concern === "string" ? body.concern : "";
  const desired = typeof body.desired === "string" ? body.desired : "";

  const systemInstruction =
    "你是一个给情侣降温的轻松助手。\n" +
    "输出要求：只输出 1-2 句中文笑话/俏皮话；不要嘲讽、不要讽刺、不涉及人格贬低；内容要温和、偏治愈；不要提 AI 或解释。";

  const userPrompt =
    `请生成一个适合吵架后“讲给对方听以降温”的小笑话/俏皮话。` +
    `\n\n` +
    `问题类型：${issueType}` +
    `\n我担心的点 concern：${concern || "（未填写）"}` +
    `\n我希望的结果 desired：${desired || "（未填写）"}` +
    `\n\n` +
    `生成时请确保：轻松但不敷衍，语气像“我在乎你”。`;

  try {
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : GEMINI_MODEL;
    const text = await geminiGenerateText({ model, systemInstruction, userPrompt });
    res.json({ ok: true, text });
  } catch (e) {
    console.error("[ai joke]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/v1/ledger/:id", async (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!requireDb(res)) return;
  const { id } = req.params;
  if (!validLedgerId(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const snap = await db.collection("ledgers").doc(id).get();
    if (!snap.exists) return res.json({ exists: false });
    const v = snap.data() || {};
    return res.json({ exists: true, data: v.data ?? null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/v1/ledger/:id", async (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!requireDb(res)) return;
  const { id } = req.params;
  if (!validLedgerId(id)) return res.status(400).json({ error: "invalid id" });
  const { data, merge } = req.body || {};
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "body.data required" });
  }
  const useMerge = merge === true || req.query.merge === "1";
  try {
    const ref = db.collection("ledgers").doc(id);
    const payload = {
      data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (useMerge) await ref.set(payload, { merge: true });
    else await ref.set(payload);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/v1/ledger/:id/stream", (req, res) => {
  if (!checkSecret(req, res)) return;
  if (!db) {
    return res.status(503).json({
      error:
        "Firestore unavailable: fix FIREBASE_SERVICE_ACCOUNT_JSON in Railway Variables",
    });
  }
  const { id } = req.params;
  if (!validLedgerId(id)) return res.status(400).json({ error: "invalid id" });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const ref = db.collection("ledgers").doc(id);
  const unsub = ref.onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const v = snap.data();
      if (!v || v.data == null) return;
      res.write(`data: ${JSON.stringify({ data: v.data })}\n\n`);
    },
    (err) => {
      console.error("onSnapshot", err);
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: String(err.message || err) })}\n\n`
        );
      } catch (_) {}
    }
  );

  const hb = setInterval(() => {
    try {
      res.write(":hb\n\n");
    } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(hb);
    unsub();
  });
});

app.listen(PORT, HOST, () => {
  console.log(`couple-rewards sync proxy listening on http://${HOST}:${PORT}`);
  if (!db) {
    console.error(
      "[couple-rewards-proxy] WARN: Firestore not connected — set valid FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  }
});
