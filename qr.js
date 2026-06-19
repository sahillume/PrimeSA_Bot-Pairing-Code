import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { randomUUID } from 'crypto';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';

const router = express.Router();

// ========================
// UTIL: SAFE DELETE FOLDER
// ========================
function removeFile(path) {
    try {
        if (fs.existsSync(path)) {
            fs.rmSync(path, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Cleanup error:', e);
    }
}

// ========================
// CONFIG
// ========================
const QR_TIMEOUT = parseInt(process.env.QR_TIMEOUT) || 20000;
const CLEANUP_DELAY = parseInt(process.env.CLEANUP_DELAY) || 8000;
const MAX_ACTIVE_SESSIONS = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 10;
const MAX_RECONNECTS = parseInt(process.env.MAX_RECONNECTS) || 3;

const logger = pino({ level: 'info' });
const activeSessions = new Map();

// ========================
// ROUTE
// ========================
router.get('/', async (req, res) => {
    if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
        return res.status(429).json({
            code: 'Too many active PrimeSA_Bot sessions'
        });
    }

    const sessionId = randomUUID();
    const sessionDir = `./qr_sessions/PrimeSA_Bot_${sessionId}`;

    activeSessions.set(sessionId, true);

    let sock = null;

    req.on('close', () => {
        logger.info({ sessionId }, 'Client disconnected → cleanup');
        removeFile(sessionDir);

        try {
            sock?.ev?.removeAllListeners();
            sock?.end?.();
        } catch {}

        activeSessions.delete(sessionId);
    });

    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    async function start() {
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        let qrSent = false;
        let responded = false;
        let reconnects = 0;

        const sendQR = async (qr) => {
            if (qrSent || responded) return;
            qrSent = true;

            try {
                qrcodeTerminal.generate(qr, { small: true });

                const img = await QRCode.toDataURL(qr);

                responded = true;
                return res.json({
                    project: "PrimeSA_Bot",
                    qr: img,
                    message: "Scan QR to link PrimeSA_Bot session"
                });
            } catch (e) {
                responded = true;
                return res.status(500).json({ error: "QR generation failed" });
            }
        };

        const config = {
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' }).child({ level: 'fatal' })
                )
            },
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        };

        sock = makeWASocket(config);

        const onUpdate = async (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr) await sendQR(qr);

            if (connection === 'open') {
                logger.info({ sessionId }, 'PrimeSA_Bot connected');

                setTimeout(() => {
                    try {
                        sock?.end?.();
                        sock?.ev?.removeAllListeners();
                        removeFile(sessionDir);
                    } catch {}

                    activeSessions.delete(sessionId);
                }, CLEANUP_DELAY);
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;

                if ([515, 503].includes(code) && reconnects < MAX_RECONNECTS) {
                    reconnects++;

                    setTimeout(() => {
                        sock = makeWASocket(config);
                        sock.ev.on('connection.update', onUpdate);
                        sock.ev.on('creds.update', saveCreds);
                    }, 2000);

                } else {
                    removeFile(sessionDir);
                    activeSessions.delete(sessionId);

                    if (!responded) {
                        return res.status(500).json({
                            error: "PrimeSA_Bot session failed"
                        });
                    }
                }
            }
        };

        sock.ev.on('connection.update', onUpdate);
        sock.ev.on('creds.update', saveCreds);

        setTimeout(() => {
            if (!responded) {
                res.status(408).json({ error: "QR timeout" });
                removeFile(sessionDir);
                activeSessions.delete(sessionId);
            }
        }, QR_TIMEOUT);
    }

    await start();
});

// ========================
// GLOBAL ERROR HANDLER
// ========================
process.on('uncaughtException', (err) => {
    const msg = String(err);
    const ignored = [
        'conflict',
        'not-authorized',
        'rate-overlimit',
        'Stream Errored',
        '515',
        '503'
    ];

    if (ignored.some(i => msg.includes(i))) return;

    console.error('PrimeSA_Bot error:', err);
});

export default router;
