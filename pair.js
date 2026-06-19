import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

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

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 44876768574 for UK, 2783551XXXX for South Africa, etc.) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let PrimeSA = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            // Auto-destroy session after 2 minutes if not used
            setTimeout(() => {
                removeFile(dirs);
                try { PrimeSA.ws.close(); } catch (e) { }
            }, 120000);

            PrimeSA.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("🚀 PrimeSA_Bot connected.");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        const sessionPrimeSA = fs.readFileSync(dirs + '/creds.json');

                        // Send session file to user
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await PrimeSA.sendMessage(userJid, {
                            document: sessionPrimeSA,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // Send video thumbnail with caption
                        await PrimeSA.sendMessage(userJid, {
                            image: { url: 'https://example.com/PrimeSA_Bot_thumbnail.jpg' },
                            caption: `🎬 *PRIME SA BOT - Setup Guide*\n\n🚀 Fast • Secure • Reliable\n📺 Watch: https://youtube.com/@professorsahil-m7q`
                        });
                        console.log("🎬 Video guide sent successfully");

                        // Send warning message (branded)
                        await PrimeSA.sendMessage(userJid, {
                            text: `╭━━━〔 PRIME SA BOT 〕━━━⬣\n\n✅ Pairing Completed Successfully\n\n📂 Your session file has been generated.\n\n⚠️ Keep this file private.\nNever share it with anyone.\n\n👑 PrimeSA_Bot\n⚡ Fast • Secure • Reliable\n\n📺 YouTube\nhttps://youtube.com/@professorsahil-m7q\n\n📢 WhatsApp Channel\nhttps://whatsapp.com/channel/0029VbCIUrC4tRrmjdI9QM1x\n\n╰━━━━━━━━━━━━━━━━━━⬣`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("👑 PrimeSA Session Generator finished.");
                        // Do not exit the process, just finish gracefully
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        // Still clean up session even if sending fails
                        removeFile(dirs);
                        // Do not exit the process, just finish gracefully
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — reconnecting...");
                        // Safer reconnect: wait 3 seconds before attempting to reconnect
                        setTimeout(initiateSession, 3000);
                    }
                }
            });

            if (!PrimeSA.authState.creds.registered) {
                await delay(3000); // Wait 3 seconds before requesting pairing code
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await PrimeSA.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join(" • ") || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            PrimeSA.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;