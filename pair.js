import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import pn from 'awesome-phonenumber';

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
  let num = (req.query.number || '').replace(/[^0-9]/g, '');

  if (!num) {
    return res.status(400).send({ error: "Number required" });
  }

  const phone = pn('+' + num);
  if (!phone.isValid()) {
    return res.status(400).send({ error: "Invalid phone number" });
  }

  num = phone.getNumber('e164').replace('+', '');
  const sessionDir = `./session_${num}`;

  removeFile(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({ level: "silent" })
      )
    },
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: Browsers.windows("Chrome")
  });

  let sent = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection } = update;

    if (connection === "open" && !sent) {
      sent = true;

      try {
        console.log("Connected. Sending creds.json...");

        const filePath = `${sessionDir}/creds.json`;

        if (!fs.existsSync(filePath)) {
          console.log("creds.json not found");
          return;
        }

        const creds = fs.readFileSync(filePath);

        const jid = jidNormalizedUser(num + "@s.whatsapp.net");

        // IMPORTANT: using SAME socket (sock), not undefined bot
        await sock.sendMessage(jid, {
          document: creds,
          fileName: "creds.json",
          mimetype: "application/json"
        });

        console.log("creds.json sent");

        await delay(1500);
        removeFile(sessionDir);

        console.log("Session cleaned");
      } catch (err) {
        console.error("Send error:", err);
        removeFile(sessionDir);
      }
    }

    if (connection === "close") {
      console.log("Connection closed");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // pairing code
  if (!sock.authState.creds.registered) {
    await delay(2000);

    try {
      const code = await sock.requestPairingCode(num);
      return res.send({ code });
    } catch (e) {
      console.error("Pairing error:", e);
      return res.status(500).send({ error: "Failed to generate pairing code" });
    }
  }
});

export default router;
