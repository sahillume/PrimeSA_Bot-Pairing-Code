import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import archiver from 'archiver';

const router = express.Router();

// Function to remove files or directories
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    // Generate unique session for each request to avoid conflicts
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const baseDir = './temp/qr_sessions';
    const dirs = `${baseDir}/session_${sessionId}`;

    // Ensure temp/qr_sessions directory exists
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    async function initiateSession() {
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
                    console.log('🟢 QR Code Generated!');
                console.log('📋 Instructions:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Go to Settings > Linked Devices');
                console.log('3. Tap "Link a Device"');
                console.log('4. Scan the QR code below');
                // Display QR in terminal
                //qrcodeTerminal.generate(qr, { small: true });
                try {
                    // Generate QR code as data URL
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        console.log('QR Code generated successfully');
                        await res.send({ 
                            qr: qrDataURL, 
                            message: 'Scan this QR code within 60 seconds using WhatsApp → Linked Devices.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (qrError) {
                    console.error('Error generating QR code:', qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            // Improved Baileys socket configuration
            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'), // Using Browsers enum for better compatibility
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false, // Disable to reduce connection issues
                generateHighQualityLinkPreview: false, // Disable to reduce connection issues
                defaultQueryTimeoutMs: 60000, // Increase timeout
                connectTimeoutMs: 60000, // Increase connection timeout
                keepAliveIntervalMs: 30000, // Keep connection alive
                retryRequestDelayMs: 250, // Retry delay
                maxRetries: 5, // Maximum retries
            };

            // Create socket and bind events
            let sock = makeWASocket(socketConfig);
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 3;

            // Connection event handler function
            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log(`🔄 Connection update: ${connection || 'undefined'}`);

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    console.log('\u2705 PrimeSA_Bot connected.');
                    console.log('💾 Session saved to:', dirs);
                    reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                    
                    try {
                        
                        
                        // Read the session file
                        const sessionPrimeSA = fs.readFileSync(dirs + '/creds.json');
                        
                        // Get the user's JID from the session
                        const userJid = Object.keys(sock.authState.creds.me || {}).length > 0 
                            ? jidNormalizedUser(sock.authState.creds.me.id) 
                            : null;
                            
                        if (userJid) {
                            // Create a ZIP archive containing creds.json + README + Deploy Guide
                            const zipName = `PrimeSA_Session_${Date.now()}.zip`;
                            const zipPath = `${dirs}/${zipName}`;

                            try {
                                await fs.promises.mkdir(dirs, { recursive: true });
                                const output = fs.createWriteStream(zipPath);
                                const archive = archiver('zip', { zlib: { level: 9 } });

                                const archivePromise = new Promise((resolve, reject) => {
                                    output.on('close', resolve);
                                    archive.on('error', reject);
                                });

                                archive.pipe(output);
                                archive.append(sessionPrimeSA, { name: 'creds.json' });
                                const readme = `╭━━━〔 PRIME SA BOT 〕━━━⬣\n\n✅ Session Generated Successfully\n\n⚠️ Never share this file with anyone.\n\n📺 YouTube\nhttps://youtube.com/@professorsahil-m7q\n\n📢 WhatsApp Channel\nhttps://whatsapp.com/channel/0029VbCIUrC4tRrmjdI9QM1x\n\n👑 Thank you for choosing PrimeSA_Bot.\n\n╰━━━━━━━━━━━━━━━━━━⬣\n`;
                                archive.append(readme, { name: 'README.txt' });
                                const deployGuide = 'PrimeSA Deployment Guide\n\n1. Unzip the package\n2. Place creds.json into your sessions folder\n3. Restart your bot\n\nYouTube: https://youtube.com/@professorsahil-m7q\nWhatsApp Channel: https://whatsapp.com/channel/0029VbCIUrC4tRrmjdI9QM1x\n';
                                archive.append(deployGuide, { name: 'Deploy_Guide.txt' });

                                archive.finalize();
                                await archivePromise;

                                // Send the ZIP to the user
                                await sock.sendMessage(userJid, {
                                    document: fs.readFileSync(zipPath),
                                    mimetype: 'application/zip',
                                    fileName: zipName
                                });
                                console.log('📦 ZIP session sent successfully to', userJid);
                            } catch (zipErr) {
                                console.error('Error creating/sending ZIP:', zipErr);
                                // Fallback: send only creds.json with improved filename
                                try {
                                    await sock.sendMessage(userJid, {
                                        document: sessionPrimeSA,
                                        mimetype: 'application/json',
                                        fileName: `PrimeSA_Session_${Date.now()}.json`
                                    });
                                    console.log('📄 Fallback: creds.json sent successfully to', userJid);
                                } catch (sendErr) {
                                    console.error('Fallback send failed:', sendErr);
                                }
                            }

                            // Send video thumbnail with caption
                            await sock.sendMessage(userJid, {
                                image: { url: 'https://example.com/PrimeSA_Bot_thumbnail.jpg' },
                                caption: `\uD83D\DE80 *PrimeSA_Bot Setup Guide*\n\n📺 Watch the complete installation guide:\nhttps://youtube.com/@professorsahil-m7q`
                            });
                            console.log('🎬 Video guide sent successfully');

                            // Send branded warning message
                            await sock.sendMessage(userJid, {
                                text: `╭━━━〔 PRIME SA BOT 〕━━━⬣\n\n✅ Session Generated Successfully\n\n⚠️ Never share this file with anyone.\n\n📺 YouTube\nhttps://youtube.com/@professorsahil-m7q\n\n📢 WhatsApp Channel\nhttps://whatsapp.com/channel/0029VbCIUrC4tRrmjdI9QM1x\n\n👑 Thank you for choosing PrimeSA_Bot.\n\n╰━━━━━━━━━━━━━━━━━━⬣`
                            });
                        } else {
                            console.log('❌ Could not determine user JID to send session file');
                        }
                    } catch (error) {
                        console.error("Error sending session file:", error);
                    }
                    
                    // Clean up session after successful connection and sending files
                    setTimeout(() => {
                        console.log('🧹 Cleaning up session...');
                        try { sock.end(); } catch (e) { }
                        try { sock.ev.removeAllListeners(); } catch (e) { }
                        const deleted = removeFile(dirs);
                        if (deleted) {
                            console.log('✅ Session cleaned up successfully');
                        } else {
                            console.log('❌ Failed to clean up session folder');
                        }
                    }, 15000); // Wait 15 seconds before cleanup to ensure messages are sent
                }

                if (connection === 'close') {
                    console.log('❌ Connection closed');
                    if (lastDisconnect?.error) {
                        console.log('❗ Last Disconnect Error:', lastDisconnect.error);
                    }
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    // Handle specific error codes
                    if (statusCode === 401) {
                        console.log('🔐 Logged out - need new QR code');
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        console.log(`🔄 Stream error (${statusCode}) - attempting to reconnect...`);
                        reconnectAttempts++;
                        
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                            // Wait a bit before reconnecting
                            setTimeout(() => {
                                try {
                                    sock = makeWASocket(socketConfig);
                                    sock.ev.on('connection.update', handleConnectionUpdate);
                                    sock.ev.on('creds.update', saveCreds);
                                } catch (err) {
                                    console.error('Failed to reconnect:', err);
                                }
                            }, 2000);
                        } else {
                            console.log('❌ Max reconnect attempts reached');
                            if (!responseSent) {
                                responseSent = true;
                                res.status(503).send({ code: 'Connection failed after multiple attempts' });
                            }
                        }
                    } else {
                        console.log('🔄 Connection lost - attempting to reconnect...');
                        // Let it reconnect automatically
                    }
                }
            };

            // Bind the event handler
            sock.ev.on('connection.update', handleConnectionUpdate);

            sock.ev.on('creds.update', saveCreds);

            // Set a timeout to clean up if no QR is generated
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    try { sock.end(); } catch (e) { }
                    try { sock.ev.removeAllListeners(); } catch (e) { }
                    removeFile(dirs);
                }
            }, 60000); // 60 second timeout

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
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