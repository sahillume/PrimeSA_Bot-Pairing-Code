import express from 'express';
import fs from 'fs';
import { randomUUID } from 'crypto';
import pino from 'pino';
import jwt from 'jsonwebtoken';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, jidNormalizedUser } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const MAX_ACTIVE = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 20;
const PAIR_EXPIRES = parseInt(process.env.PAIR_EXPIRES) || 60; // seconds

// map token -> { sock, dir, phone, timeout }
const activeSessions = new Map();

function safeRm(dir) {
  try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { logger.error({ err: e }, 'remove failed'); }
}

function verifyAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) return res.status(401).json({ error: 'Not authorized' });
    const secret = process.env.ADMIN_SECRET || 'devsecret';
    const decoded = jwt.verify(token, secret);
    if (!decoded || !decoded.admin) return res.status(401).json({ error: 'Not authorized' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Not authorized' });
  }
}

router.get('/', async (req, res) => {
  const raw = req.query.number;
  if (!raw) return res.status(400).json({ error: 'Phone number required' });

  // Validate phone
  let num = String(raw).replace(/[^0-9+]/g, '');
  const phone = pn(num.startsWith('+') ? num : '+' + num);
  if (!phone.isValid()) return res.status(400).json({ error: 'Invalid phone number' });
  num = phone.getNumber('e164').replace('+', '');

  if (activeSessions.size >= MAX_ACTIVE) return res.status(429).json({ error: 'Server busy. Try again later.' });

  const token = randomUUID();
  const dir = `./sessions/${token}`;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const socketConfig = {
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })) },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Chrome'),
    };

    const createSocket = () => makeWASocket(socketConfig);
    const sock = createSocket();

    // Save creds when updated
    sock.ev.on('creds.update', saveCreds);

    // When paired (creds updated/registered) send token as text and cleanup
    const onPaired = async () => {
      try {
        const j = jidNormalizedUser(num + '@s.whatsapp.net');
        const msg = `✅ PrimeSA_Bot paired successfully.\nSession Token: ${token}\nDo NOT share this token.`;
        try { await sock.sendMessage(j, { text: msg }); } catch (e) { logger.error({ err: e }, 'failed send token'); }
      } finally {
        // clear expiry timeout and cleanup after short delay
        const info = activeSessions.get(token);
        if (info && info.timeout) clearTimeout(info.timeout);
        setTimeout(() => {
          try { sock.ev.removeAllListeners(); } catch (e) {}
          try { sock.end?.(); } catch (e) {}
          activeSessions.delete(token);
        }, 5000);
      }
    };

    sock.ev.on('creds.update', onPaired);

    // Register active session with expiry
    const timeout = setTimeout(() => {
      try {
        logger.info({ token, num }, 'pairing expired; cleaning');
        try { sock.ev.removeAllListeners(); } catch (e) {}
        try { sock.end?.(); } catch (e) {}
      } finally {
        safeRm(dir);
        activeSessions.delete(token);
      }
    }, PAIR_EXPIRES * 1000);

    activeSessions.set(token, { sock, dir, phone: num, timeout });

    // Request pairing code
    const rawCode = await sock.requestPairingCode(num);
    const pairingCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;

    if (!res.headersSent) return res.json({ success: true, pairingCode, token, expiresIn: PAIR_EXPIRES });

  } catch (err) {
    logger.error({ err }, 'pair generation failed');
    safeRm(dir);
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate pairing code' });
  }
});

// Admin-only endpoint to list active sessions
router.get('/_active', verifyAdmin, (req, res) => {
  const out = [];
  for (const [token, info] of activeSessions.entries()) out.push({ token, phone: info.phone });
  res.json({ active: out });
});

// Admin-only: download creds (creds.json) for a token
router.get('/download/:token', verifyAdmin, (req, res) => {
  const token = req.params.token;
  const info = activeSessions.get(token);
  const dir = info ? info.dir : `./sessions/${token}`;
  const credsPath = `${dir}/creds.json`;
  if (!fs.existsSync(credsPath)) return res.status(404).json({ error: 'creds not found' });
  try {
    const data = fs.readFileSync(credsPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (e) {
    res.status(500).json({ error: 'failed to read creds' });
  }
});

// Admin-only: revoke / delete a token session
router.delete('/:token', verifyAdmin, (req, res) => {
  const token = req.params.token;
  const info = activeSessions.get(token);
  if (info) {
    try { if (info.timeout) clearTimeout(info.timeout); } catch (e) {}
    try { info.sock.ev.removeAllListeners(); info.sock.end?.(); } catch (e) {}
    safeRm(info.dir);
    activeSessions.delete(token);
    return res.json({ ok: true });
  }
  // if not active, try to remove from disk
  const dir = `./sessions/${token}`;
  if (fs.existsSync(dir)) { safeRm(dir); return res.json({ ok: true }); }
  return res.status(404).json({ error: 'token not found' });
});

export default router;
