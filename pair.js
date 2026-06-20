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
    if (!num) return res.status(400).send({ error: "Number required" });
    const phone = pn('+' + num.toString());
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 27835515085 for South Africa, etc.) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let PrimeSA_Bot = makeWASocket({
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

            PrimeSA_Bot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session PrimeSA-file to user...");
                    
                    try {
                        if (!fs.existsSync(dirs + '/creds.json')) {
    console.log("Session not ready yet");
    return;
}

                        // Send video thumbnail with caption
                        await PrimeSA_Bot.sendMessage(userJid, {
                        image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/hqdefault.jpg' },
                        caption: `🎬 *PrimeSA_Bot MD V1.0 Setup Guide!*\n\n📺 Watch Now:\nhttps://youtube.com/@professorsahil-m7q?si=1kLYPaExry8NceJU`
                        });

                        console.log("🎬 Video guide sent successfully.");

                        // Send warning message
                        await PrimeSA_Bot.sendMessage(userJid, {
                        text: `⚠️ Do not share this PrimeSA_File with anybody ⚠️

┏━━━━━━━━━━━━━━━━━━━━━━━⬣
┃ 🤖 PrimeSA_Bot MD V1.0
┃ ⚡ Fast • Secure • Reliable
┣━━━━━━━━━━━━━━━━━━━━━━━⬣
┃ ✅ Thanks for using PrimeSA_Bot!
┃ 📺 YouTube: https://youtube.com/@professorsahil-m7q
┃ 💬 WhatsApp Channel: https://whatsapp.com/channel/0029VbCIUrC4tRrmjdI9QM1x
┣━━━━━━━━━━━━━━━━━━━━━━━⬣
┃ © 2026 Professor Sahil
┃ ❤️ Powered by PrimeSA_Bot
┗━━━━━━━━━━━━━━━━━━━━━━━⬣`
});
                        console.log("⚠️ Warning message sent successfully");

                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
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
                        console.log("🔁 Connection closed — restarting...");
                        setTimeout(() => {
                        initiateSession();
                                 }, 3000);
                    }
                }
            });

            if (!PrimeSA_Bot.authState.creds.registered) {
                await delay(3000); // Wait 3 seconds before requesting pairing code
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await PrimeSA_Bot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
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

            PrimeSA_Bot.ev.on('creds.update', saveCreds);
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
