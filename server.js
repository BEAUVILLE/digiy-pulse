// =====================================
// DIGIY Pulse - Serveur Temps Réel
// Node.js + Express + SSE + JWT
// =====================================

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const streams = new Map();
const recent = new Map();

function pushRecent(merchantId, evt) {
  const buf = recent.get(merchantId) || [];
  buf.push(evt);
  while (buf.length > 200) buf.shift();
  recent.set(merchantId, buf);
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

// =========================
// Événements en temps réel
// =========================
app.get('/events', (req, res) => {
  const claims = verifyToken(req.query.token);
  if (!claims) return res.status(401).json({ error: 'invalid_token' });
  const merchantId = claims.merchantId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const buf = recent.get(merchantId) || [];
  res.write(`event: bootstrap\n`);
  res.write(`data: ${JSON.stringify({ ok: true, recent: buf })}\n\n`);

  if (!streams.has(merchantId)) streams.set(merchantId, new Set());
  const set = streams.get(merchantId);
  set.add(res);
  req.on('close', () => set.delete(res));
});

// =========================
// Ingestion des transactions
// =========================
app.post('/ingest/tx', (req, res) => {
  const auth = (req.headers.authorization || '').split(' ')[1];
  const claims = verifyToken(auth);
  if (!claims) return res.status(401).json({ error: 'unauthorized' });
  const merchantId = claims.merchantId;

  const { amount, currency = 'EUR', method, item, meta } = req.body || {};
  if (!amount || !method) return res.status(400).json({ error: 'missing_fields' });

  const evt = {
    type: 'tx',
    ts: Date.now(),
    amount: +amount,
    currency,
    method,
    item: item || null,
    meta: meta || {}
  };

  pushRecent(merchantId, evt);

  const set = streams.get(merchantId);
  if (set) {
    const payload = `event: tx\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const client of set) client.write(payload);
  }

  res.json({ ok: true });
});

// =========================
// Statistiques du jour
// =========================
app.get('/stats/today', (req, res) => {
  const claims = verifyToken(req.query.token);
  if (!claims) return res.status(401).json({ error: 'invalid_token' });
  const merchantId = claims.merchantId;
  const buf = recent.get(merchantId) || [];
  const ca = buf.filter(e => e.type === 'tx').reduce((s, e) => s + e.amount, 0);
  const tx = buf.filter(e => e.type === 'tx').length;
  const aov = tx ? ca / tx : 0;
  res.json({ ok: true, ca, tx, aov });
});

// =========================
// Route admin pour générer un token (mint)
// =========================
app.get('/mint', (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const merchantId = req.query.merchantId || 'default-merchant';
  const token = signToken({ merchantId });
  res.json({ ok: true, token });
});

// =========================
// Ping
// =========================
app.get('/', (_, res) => res.send('DIGIY Pulse API OK 🚀'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`DIGIY Pulse en ligne sur le port ${port}`));
