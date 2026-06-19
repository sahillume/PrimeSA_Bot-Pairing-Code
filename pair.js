import express from 'express';
import fs from 'fs';
import pino from 'pino';
import jwt from 'jsonwebtoken';
import pn from 'awesome-phonenumber';
import { randomUUID } from 'crypto';

import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

const router = express.Router();
const logger = pino({ level: 'info' });

// =====================
// CONFIG
// =====================
const MAX_ACTIVE = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 20;
const PAIR_EXPIRES = parseInt(process.env.PAIR_EXPIRES) || 60;

const sessions = new Map();

// =====================
// SAFE CLEANUP
// =====================
function safeRm(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    logger.error({ err: e }, 'cleanup failed');
  }
}

// =====================
// ADMIN AUTH
// =====================
function verifyAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) return res.status(401).json({ error: 'Not authorized' });

    const decoded = jwt.verify(token, process.env.ADMIN_SECRET || 'devsecret');
    if (!decoded?.admin) return res.status(401).json({ error: 'Not authorized' });

    next();
  } catch {
    return res.status(401).json({ error: 'Not authorized' });
  }
}

// =====================
// ROUTE: PAIRING
// =====================
router.get('/', async (req, res) => {
  let raw = req.query.number;
  if (!raw) return res.status(400).json({ error: 'Phone number required' });

  if (sessions.size >= MAX_ACTIVE) {
    return res.status(429).json({ error: 'Server busy' });
  }

  // normalize phone
  let num = String(raw).replace(/[^0-9+]/g, '');
  const phone = pn(num.startsWith('+') ? num : '+' + num);

  if (!phone.isValid()) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  num = phone.getNumber('e164').replace('+', '');

  const token = randomUUID();
  const dir = `./sessions/PrimeSA_${token}`;

  fs.mkdirSync(dir, { recursive: true });

  let sock;
  let qrSent = false;
  let finished = false;

  sessions.set(token, { dir, num });

  // auto expire session
  const expireTimer = setTimeout(() => {
    logger.info({ token }, 'session expired');

    try {
      sock?.ev?.removeAllListeners();
      sock?.end?.();
    } catch {}

    safeRm(dir);
    sessions.delete(token);

    if (!finished && !res.headersSent) {
      res.status(408).json({ error: 'Pairing expired' });
    }
  }, PAIR_EXPIRES * 1000);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      printQRInTerminal: false
    });

    // creds save
    sock.ev.on('creds.update', saveCreds);

    // pairing success handler
    sock.ev.on('creds.update', async () => {
      if (finished) return;

      try {
        const jid = jidNormalizedUser(num + '@s.whatsapp.net');

        await sock.sendMessage(jid, {
          text: `✅ PrimeSA_Bot paired successfully\nToken: ${token}`
        });

        finished = true;

        clearTimeout(expireTimer);

        setTimeout(() => {
          try {
            sock?.ev?.removeAllListeners();
            sock?.end?.();
          } catch {}

          safeRm(dir);
          sessions.delete(token);
        }, 5000);
      } catch {}
    });

    // connection handler
    sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
      if (qr && !qrSent && !finished) {
        qrSent = true;
        return res.json({
          success: true,
          qr,
          token,
          expiresIn: PAIR_EXPIRES
        });
      }

      if (connection === 'open') {
        logger.info({ token }, 'connected');
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;

        if (code === 401) {
          safeRm(dir);
          sessions.delete(token);
        }

        if ([515, 503].includes(code)) {
          try {
            sock = makeWASocket({
              version,
              auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
              },
              logger: pino({ level: 'silent' }),
              browser: Browsers.windows('Chrome')
            });

            sock.ev.on('creds.update', saveCreds);
          } catch {}
        }
      }
    });

  } catch (err) {
    logger.error({ err }, 'pairing failed');
    safeRm(dir);
    sessions.delete(token);

    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to create session' });
    }
  }
});

// =====================
// ADMIN ROUTES
// =====================
router.get('/_active', verifyAdmin, (req, res) => {
  const list = [...sessions.entries()].map(([token, v]) => ({
    token,
    phone: v.num
  }));

  res.json({ active: list });
});

router.delete('/:token', verifyAdmin, (req, res) => {
  const { token } = req.params;
  const info = sessions.get(token);

  if (info) {
    safeRm(info.dir);
    sessions.delete(token);
    return res.json({ ok: true });
  }

  return res.status(404).json({ error: 'not found' });
});

export default router;
