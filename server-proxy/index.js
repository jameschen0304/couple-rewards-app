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
  res.json({ ok: true, firestore: Boolean(db) });
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
