import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

// Importing the modules
import pairRouter from './pair.js';
import qrRouter from './qr.js';
import QRCode from 'qrcode';

const app = express();

// Resolve the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

// basic rate limiting (protect endpoints from abuse)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.RATE_LIMIT_MAX) || 60, standardHeaders: true, legacyHeaders: false });
app.use(['/pair', '/qr', '/'], apiLimiter);

// Admin routes: login and check
app.post('/admin/login', (req, res) => {
    const { password } = req.body || {};
    if (!process.env.ADMIN_PASSWORD) return res.status(500).send({ error: 'Admin not configured' });
    if (!password) return res.status(400).send({ error: 'Missing password' });
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).send({ error: 'Invalid password' });
    const token = jwt.sign({ admin: true }, process.env.ADMIN_SECRET || 'devsecret', { expiresIn: '2h' });
    res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 2 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.send({ ok: true });
});

app.get('/admin/check', (req, res) => {
    try {
        const token = req.cookies?.admin_token || null;
        if (!token) return res.send({ admin: false });
        const decoded = jwt.verify(token, process.env.ADMIN_SECRET || 'devsecret');
        return res.send({ admin: Boolean(decoded?.admin) });
    } catch (e) {
        return res.send({ admin: false });
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

app.listen(PORT, () => {
    console.log(`YouTube: https://youtube.com/@professorsahil-m7q?si=qj6xxaxPEHEYVO8d\n\nGitHub: https://github.com/sahillume\n\nServer running on http://localhost:${PORT}`);
});

export default app;
