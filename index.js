import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';

// Import Routes
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();

// Resolve current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// Increase EventEmitter listeners
EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Home Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Routes
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Start Server
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║          PrimeSA_Bot                 ║
╠══════════════════════════════════════╣
║ 🚀 Session Generator Online          ║
║ 🌐 http://localhost:${PORT}                       ║
║                                      ║
║ GitHub : github.com/sahillume        ║
║ YouTube: youtube.com/@professorsahil ║
║ Version: 1.0.0                       ║
╚══════════════════════════════════════╝
`);
});

export default app;