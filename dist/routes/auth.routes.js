"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenStore = void 0;
exports.initTokenStore = initTokenStore;
const express_1 = require("express");
const googleapis_1 = require("googleapis");
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const logger_1 = __importDefault(require("../logger"));
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function issueAccessToken() {
    return jsonwebtoken_1.default.sign({ sub: 'authenticated' }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}
async function issueRefreshToken(res) {
    const token = crypto_1.default.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await db_1.default.query('INSERT INTO refresh_tokens (token, expires_at) VALUES ($1, $2)', [token, expiresAt]);
    res.cookie('refreshToken', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: REFRESH_TOKEN_TTL_MS,
    });
}
const router = (0, express_1.Router)();
// In-memory token store — seeded from PostgreSQL on startup
exports.tokenStore = new Map();
async function initTokenStore() {
    const { rows } = await db_1.default.query('SELECT * FROM tokens');
    rows.forEach((row) => {
        exports.tokenStore.set(row.account_id, {
            accessToken: row.access_token,
            refreshToken: row.refresh_token || '',
            email: row.email || '',
        });
    });
    logger_1.default.info('Token store seeded from DB', { count: rows.length });
}
function getOAuthClient() {
    return new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/google/callback');
}
// GET /api/v1/auth/google — start OAuth flow
router.get('/auth/google', (req, res) => {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/userinfo.email',
        ],
    });
    res.redirect(url);
});
// GET /api/v1/auth/google/callback — handle OAuth callback
router.get('/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const oauth2Client = getOAuthClient();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        // Get user email
        const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();
        const email = data.email || '';
        const accountId = `gmail-${email}`;
        logger_1.default.info('Gmail OAuth success', { accountId, email });
        exports.tokenStore.set(accountId, {
            accessToken: tokens.access_token || '',
            refreshToken: tokens.refresh_token || '',
            email,
        });
        // Persist token to PostgreSQL
        await db_1.default.query(`INSERT INTO tokens (account_id, access_token, refresh_token, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         email = EXCLUDED.email`, [accountId, tokens.access_token || '', tokens.refresh_token || '', email]);
        // Issue JWT + refresh token
        const accessToken = issueAccessToken();
        await issueRefreshToken(res);
        // Redirect back to frontend with account info + access token
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/auth/callback?accountId=${accountId}&email=${email}&provider=gmail&token=${accessToken}`);
    }
    catch (err) {
        logger_1.default.error('Gmail OAuth callback failed', { message: err.message, stack: err.stack });
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
    }
});
// GET /api/v1/auth/token/:accountId — get stored token (for internal use)
router.get('/auth/token/:accountId', (req, res) => {
    const token = exports.tokenStore.get(req.params.accountId);
    if (!token)
        return res.status(404).json({ error: 'Token not found' });
    res.json({ accessToken: token.accessToken });
});
// ── Microsoft / Office 365 OAuth ──────────────────────────────────────────
function getMicrosoftAuthUrl() {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/microsoft/callback';
    const scopes = [
        'openid', 'email', 'profile', 'offline_access',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.ReadWrite',
    ].join(' ');
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: scopes,
        response_mode: 'query',
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}
// GET /api/v1/auth/microsoft
router.get('/auth/microsoft', (_req, res) => {
    if (!process.env.MICROSOFT_CLIENT_ID) {
        return res.status(500).send('Microsoft OAuth not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to .env');
    }
    res.redirect(getMicrosoftAuthUrl());
});
// GET /api/v1/auth/microsoft/callback
router.get('/auth/microsoft/callback', async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    try {
        const clientId = process.env.MICROSOFT_CLIENT_ID;
        const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
        const redirectUri = process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/microsoft/callback';
        // Exchange code for tokens
        const tokenRes = await axios_1.default.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token, refresh_token } = tokenRes.data;
        // Get user email from MS Graph
        const userRes = await axios_1.default.get('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const email = userRes.data.mail || userRes.data.userPrincipalName || '';
        const accountId = `office365-${email}`;
        logger_1.default.info('Office365 OAuth success', { accountId, email });
        exports.tokenStore.set(accountId, { accessToken: access_token, refreshToken: refresh_token || '', email });
        await db_1.default.query(`INSERT INTO tokens (account_id, access_token, refresh_token, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         email = EXCLUDED.email`, [accountId, access_token, refresh_token || '', email]);
        const accessToken = issueAccessToken();
        await issueRefreshToken(res);
        res.redirect(`${frontendUrl}/auth/callback?accountId=${accountId}&email=${encodeURIComponent(email)}&provider=office365&token=${accessToken}`);
    }
    catch (err) {
        logger_1.default.error('Office365 OAuth callback failed', { message: err.message, stack: err.stack });
        res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
    }
});
// POST /api/v1/auth/refresh — issue new access token using refresh token cookie
router.post('/auth/refresh', async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken)
        return res.status(401).json({ error: 'No refresh token' });
    try {
        const { rows } = await db_1.default.query('SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()', [refreshToken]);
        if (rows.length === 0)
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        const accessToken = issueAccessToken();
        logger_1.default.info('Access token refreshed via refresh token');
        res.json({ accessToken });
    }
    catch (err) {
        logger_1.default.error('Token refresh failed', { message: err.message, stack: err.stack });
        res.status(500).json({ error: 'Token refresh failed' });
    }
});
// POST /api/v1/auth/logout — clear refresh token
router.post('/auth/logout', async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
        await db_1.default.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ success: true });
});
exports.default = router;
