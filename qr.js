import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { randomUUID } from 'crypto';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Configuration constants
const QR_TIMEOUT = parseInt(process.env.QR_TIMEOUT) || 20000; // 20s default
const CLEANUP_DELAY = parseInt(process.env.CLEANUP_DELAY) || 5000; // 5s
const MAX_RECONNECTS = parseInt(process.env.MAX_RECONNECTS) || 3;
const MAX_ACTIVE_SESSIONS = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 10;

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Track active sessions to limit resource usage
const activeSessions = new Map();

router.get('/', async (req, res) => {
    // Limit active sessions
    if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
        if (!res.headersSent) return res.status(429).send({ code: 'Too many concurrent sessions. Please try again later.' });
        return;
    }

    // Generate UUID session for each request
    const sessionId = randomUUID();
    const dirs = `./qr_sessions/session_${sessionId}`;

    // Ensure we can cleanup if client disconnects
    let sock = null;
    req.on('close', () => {
        logger.info({ sessionId }, 'Client closed connection, cleaning up session');
        try {
            removeFile(dirs);
            if (sock) {
                try { sock.ev.removeAllListeners(); } catch (e) {}
                try { sock.end?.(); } catch (e) {}
            }
        } finally {
            activeSessions.delete(sessionId);
        }
    });

    // Ensure qr_sessions directory exists
    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        // mark active
        activeSessions.set(sessionId, true);
        // ✅ PERMANENT FIX: Create the session folder before anything
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();

            let qrGenerated = false;
            let responseSent = false;

            // QR Code handling logic
            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;

                qrGenerated = true;
                logger.info({ sessionId }, 'QR Code Generated');
                qrcodeTerminal.generate(qr, { small: true });
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        if (res.headersSent) return;
                        logger.info({ sessionId }, 'Sending QR to client');
                        await res.send({
                            qr: qrDataURL,
                            message: 'QR Code Generated! Scan it with your WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (qrError) {
                    logger.error({ err: qrError, sessionId }, 'Error generating QR code');
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            // Improved Baileys socket configuration
            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })) },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            };

            const createSocket = () => makeWASocket(socketConfig);

            // Create socket and bind events
            sock = createSocket();
            let reconnectAttempts = 0;

            // Connection event handler function
            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                logger.info({ sessionId, connection }, 'Connection update');

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    logger.info({ sessionId, dirs }, 'Connected successfully, session saved');
                    reconnectAttempts = 0;

                    // Clean up session after successful connection
                    setTimeout(() => {
                        try {
                            logger.info({ sessionId }, 'Cleaning up session after connect');
                            if (sock) {
                                try { sock.ev.removeAllListeners(); } catch (e) {}
                                try { sock.end?.(); } catch (e) {}
                            }
                            removeFile(dirs);
                        } finally {
                            activeSessions.delete(sessionId);
                        }
                    }, CLEANUP_DELAY);
                }

                if (connection === 'close') {
                    logger.info({ sessionId, lastDisconnect }, 'Connection closed');
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || lastDisconnect?.error?.toString?.();

                    // Handle specific error codes / reasons
                    if (statusCode === 401 || /not-authorized|logged out/i.test(reason || '')) {
                        logger.info({ sessionId }, 'Logged out - need new QR code');
                        try {
                            if (sock) { sock.ev.removeAllListeners(); sock.end?.(); }
                        } catch (e) {}
                        removeFile(dirs);
                        activeSessions.delete(sessionId);
                    } else if (statusCode === 515 || statusCode === 503 || /stream errored|rate-overlimit/i.test(reason || '')) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= MAX_RECONNECTS) {
                            logger.info({ sessionId, attempt: reconnectAttempts }, 'Reconnect attempt');
                            setTimeout(() => {
                                try {
                                    if (sock) { sock.ev.removeAllListeners(); sock.end?.(); }
                                    sock = createSocket();
                                    sock.ev.on('connection.update', handleConnectionUpdate);
                                    sock.ev.on('creds.update', saveCreds);
                                } catch (err) {
                                    logger.error({ err }, 'Failed to reconnect');
                                }
                            }, 2000);
                        } else {
                            if (!responseSent && !res.headersSent) {
                                responseSent = true;
                                res.status(503).send({ code: 'Connection failed after multiple attempts' });
                            }
                            try { if (sock) { sock.ev.removeAllListeners(); sock.end?.(); } } catch (e) {}
                            removeFile(dirs);
                            activeSessions.delete(sessionId);
                        }
                    } else {
                        logger.info({ sessionId }, 'Connection lost - letting socket attempt reconnect');
                    }
                }
            };

            // Bind the event handler
            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            // Set a timeout to clean up if no QR is generated
            setTimeout(() => {
                if (!responseSent) {
                    if (!res.headersSent) {
                        res.status(408).send({ code: 'QR generation timeout' });
                    }
                    try { if (sock) { sock.ev.removeAllListeners(); sock.end?.(); } } catch (e) {}
                    removeFile(dirs);
                    activeSessions.delete(sessionId);
                }
            }, QR_TIMEOUT);

        } catch (err) {
            logger.error({ err, sessionId }, 'Error initializing session');
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            try { if (sock) { sock.ev.removeAllListeners(); sock.end?.(); } } catch (e) {}
            removeFile(dirs);
            activeSessions.delete(sessionId);
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    const e = String(err || '');
    // ignore known transient errors
    const ignored = [
        'conflict', 'not-authorized', 'Socket connection timeout', 'rate-overlimit',
        'Connection Closed', 'Timed Out', 'Value not found', 'Stream Errored', 'Stream Errored (restart required)',
        'statusCode: 515', 'statusCode: 503'
    ];
    for (const ig of ignored) {
        if (e.includes(ig)) return;
    }
    logger ? logger.error({ err }, 'Caught exception') : console.log('Caught exception: ', err);
});

// Clean up temporary qr_sessions on shutdown to avoid orphaned folders
process.on('SIGINT', () => {
    try {
        if (fs.existsSync('./qr_sessions')) {
            fs.rmSync('./qr_sessions', { recursive: true, force: true });
            logger ? logger.info('Cleaned up qr_sessions on SIGINT') : console.log('Cleaned up qr_sessions on SIGINT');
        }
    } catch (e) {
        logger ? logger.error({ err: e }, 'Error cleaning qr_sessions on SIGINT') : console.error(e);
    }
    process.exit(0);
});

export default router; 