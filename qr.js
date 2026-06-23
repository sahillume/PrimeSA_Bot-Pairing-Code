import express from 'express';
import fs from 'fs';
import pino from 'pino';
import QRCode from 'qrcode';

import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import { delay } from '@whiskeysockets/baileys';

const router = express.Router();

function removeFile(path) {
  try {
    if (fs.existsSync(path)) {
      fs.rmSync(path, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

router.get('/', async (req, res) => {
  const sessionId = Date.now().toString();
  const dir = `./qr_sessions/${sessionId}`;

  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  let sentResponse = false;
  let sock;

  const sendQR = async (qr) => {
    try {
      const qrImage = await QRCode.toDataURL(qr);

      if (!sentResponse) {
        sentResponse = true;

        return res.json({
          qr: qrImage,
          message: "Scan QR from WhatsApp Linked Devices"
        });
      }
    } catch (e) {
      console.error("QR error:", e);

      if (!sentResponse) {
        sentResponse = true;
        return res.status(500).json({ error: "QR generation failed" });
      }
    }
  };

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    browser: Browsers.windows("Chrome"),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      await sendQR(qr);
    }

    if (connection === "open") {
      console.log("✅ Connected");

      try {
        const filePath = `${dir}/creds.json`;

        if (fs.existsSync(filePath)) {
          const creds = fs.readFileSync(filePath);

          // ❗ FIX: No fake JID guessing
          const me = sock.user?.id;

          if (me) {
            const jid = jidNormalizedUser(me);

            await sock.sendMessage(jid, {
              document: creds,
              fileName: "creds.json",
              mimetype: "application/json"
            });

            console.log("📄 creds.json sent");
          } else {
            console.log("❌ Could not get user ID");
          }
        }

      } catch (e) {
        console.error("Send error:", e);
      }

      setTimeout(() => {
        console.log("🧹 Cleaning session...");
        removeFile(dir);
      }, 8000);
    }

    if (connection === "close") {
      console.log("❌ Connection closed");

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === 401) {
        console.log("Session invalid");
        removeFile(dir);
      }
    }
  });

  // Timeout safety
  setTimeout(() => {
    if (!sentResponse) {
      sentResponse = true;
      removeFile(dir);
      return res.status(408).json({ error: "QR timeout" });
    }
  }, 30000);
});

export default router;
