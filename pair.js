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

// Clean folder helper
function removeFile(path) {
    try {
        if (fs.existsSync(path)) {
            fs.rmSync(path, { recursive: true, force: true });
        }
    } catch (e) {
        console.error("removeFile error:", e);
    }
}

router.get('/', async (req, res) => {
    try {
        let num = req.query.number;

        if (!num) {
            return res.status(400).json({ error: "Number required" });
        }

        num = num.replace(/[^0-9]/g, '');

        const phone = pn('+' + num);
        if (!phone.isValid()) {
            return res.status(400).json({ error: "Invalid phone number" });
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
                    pino({ level: "fatal" })
                ),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.windows("Chrome"),
        });

        let sent = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // QR -> Pairing Code flow fallback
            if (!sent && !state.creds.registered) {
                try {
                    await delay(2000);

                    const code = await sock.requestPairingCode(num);

                    sent = true;

                    return res.json({
                        success: true,
                        pairingCode: code,
                        number: num
                    });

                } catch (e) {
                    console.error("Pairing error:", e);
                    return res.status(500).json({
                        error: "Failed to generate pairing code"
                    });
                }
            }

            if (connection === 'open') {
                console.log("✅ Connected");
                return;
            }

            if (connection === 'close') {
                console.log("❌ Connection closed");

                const status = lastDisconnect?.error?.output?.statusCode;

                if (status === 401) {
                    console.log("Session invalid");
                    removeFile(sessionDir);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // safety timeout (prevents Render freeze)
        setTimeout(() => {
            if (!sent) {
                sent = true;
                return res.status(408).json({
                    error: "Timeout generating pairing code"
                });
            }
        }, 25000);

    } catch (err) {
        console.error("Fatal error:", err);
        return res.status(500).json({
            error: "Service Unavailable"
        });
    }
});

export default router;
