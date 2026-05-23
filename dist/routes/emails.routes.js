"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAccounts = void 0;
const express_1 = require("express");
const gmail_service_1 = require("../services/gmail.service");
const imap_service_1 = require("../services/imap.service");
const office365_service_1 = require("../services/office365.service");
const ai_service_1 = require("../services/ai.service");
const auth_routes_1 = require("./auth.routes");
const googleapis_1 = require("googleapis");
const axios_1 = __importDefault(require("axios"));
const db_1 = __importDefault(require("../db"));
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
const gmailService = new gmail_service_1.GmailService();
const imapService = new imap_service_1.ImapService();
const office365Service = new office365_service_1.Office365Service();
const aiService = new ai_service_1.AIService();
// In-memory cache loaded from PostgreSQL on startup
const accounts = new Map();
async function initAccounts() {
    const { rows } = await db_1.default.query('SELECT * FROM accounts');
    rows.forEach((row) => {
        accounts.set(row.id, {
            id: row.id,
            email: row.email,
            provider: row.provider,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            imapHost: row.imap_host,
            imapPort: row.imap_port,
            imapPassword: row.imap_password,
            color: row.color,
            userId: row.user_id,
        });
    });
    logger_1.default.info('Loaded accounts from DB', { count: rows.length });
}
exports.initAccounts = initAccounts;
// Email cache: accountId -> Email[]
const emailCache = new Map();
// Loading status per account: accountId -> { loading, total, loaded }
const loadingStatus = new Map();
async function getFreshAccessToken(account) {
    const stored = auth_routes_1.tokenStore.get(account.id);
    const refreshToken = stored?.refreshToken || account.refreshToken || '';
    if (account.provider === 'gmail') {
        try {
            logger_1.default.debug('Refreshing Gmail token', { accountId: account.id });
            const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await oauth2Client.refreshAccessToken();
            const newToken = credentials.access_token || '';
            logger_1.default.info('Gmail token refreshed', { accountId: account.id });
            auth_routes_1.tokenStore.set(account.id, { ...stored, accessToken: newToken });
            await db_1.default.query('UPDATE tokens SET access_token = $1 WHERE account_id = $2', [newToken, account.id]);
            return newToken;
        }
        catch (err) {
            logger_1.default.error('Gmail token refresh failed', { accountId: account.id, message: err.message, stack: err.stack });
            return stored?.accessToken || '';
        }
    }
    if (account.provider === 'office365') {
        try {
            logger_1.default.debug('Refreshing Office365 token', { accountId: account.id });
            const res = await axios_1.default.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID,
                client_secret: process.env.MICROSOFT_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            const newToken = res.data.access_token || '';
            logger_1.default.info('Office365 token refreshed', { accountId: account.id });
            auth_routes_1.tokenStore.set(account.id, { ...stored, accessToken: newToken });
            await db_1.default.query('UPDATE tokens SET access_token = $1 WHERE account_id = $2', [newToken, account.id]);
            return newToken;
        }
        catch (err) {
            logger_1.default.error('Office365 token refresh failed', { accountId: account.id, message: err.message, stack: err.stack });
            return stored?.accessToken || '';
        }
    }
    return stored?.accessToken || account.accessToken || '';
}
function getAccessToken(account) {
    if (account.provider === 'gmail' || account.provider === 'office365') {
        const stored = auth_routes_1.tokenStore.get(account.id);
        return stored?.accessToken || account.accessToken || '';
    }
    return account.accessToken || '';
}
function getImapConfig(account) {
    return {
        host: account.imapHost,
        port: account.imapPort,
        email: account.email,
        password: account.imapPassword,
    };
}
// Background job: fetch emails in chunks of 50 and push to cache
async function fetchEmailsInBackground(account, allIds) {
    const accountId = account.id;
    const CHUNK_SIZE = 50;
    const total = allIds.length;
    logger_1.default.info('Background fetch started', { accountId, total });
    loadingStatus.set(accountId, { loading: true, total, loaded: 0 });
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);
        try {
            const emails = await gmailService.fetchEmailsByIds(await getFreshAccessToken(account), accountId, chunk);
            const existing = emailCache.get(accountId) || [];
            const existingIds = new Set(existing.map((e) => e.id));
            const unique = emails.filter((e) => !existingIds.has(e.id));
            emailCache.set(accountId, [...existing, ...unique]);
            const status = loadingStatus.get(accountId);
            loadingStatus.set(accountId, { ...status, loaded: status.loaded + emails.length });
        }
        catch (err) {
            logger_1.default.warn('Background fetch chunk failed', { accountId, chunk: i, message: err.message, stack: err.stack });
        }
    }
    const status = loadingStatus.get(accountId);
    loadingStatus.set(accountId, { ...status, loading: false });
    logger_1.default.info('Background fetch complete', { accountId, loaded: status.loaded });
}
// POST /api/v1/accounts
router.post('/accounts', async (req, res) => {
    const userId = req.userId;
    const { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color } = req.body;
    const account = { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color, userId };
    accounts.set(id, account);
    // Persist to PostgreSQL with user_id
    await db_1.default.query(`INSERT INTO accounts (id, email, provider, access_token, refresh_token, imap_host, imap_port, imap_password, color, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email, provider = EXCLUDED.provider,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
       imap_host = EXCLUDED.imap_host, imap_port = EXCLUDED.imap_port,
       imap_password = EXCLUDED.imap_password, color = EXCLUDED.color,
       user_id = EXCLUDED.user_id`, [id, email, provider, accessToken ?? null, refreshToken ?? null, imapHost ?? null, imapPort ?? null, imapPassword ?? null, color ?? null, userId]);
    // Clear old cache when account is re-added
    emailCache.delete(id);
    loadingStatus.delete(id);
    res.json({ success: true, accountId: id });
});
// GET /api/v1/accounts
router.get('/accounts', (req, res) => {
    const userId = req.userId;
    const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId);
    res.json(userAccounts.map(({ imapPassword, accessToken, userId: _uid, ...safe }) => safe));
});
// DELETE /api/v1/accounts/:id
router.delete('/accounts/:id', async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    const account = accounts.get(id);
    // Only allow deleting own accounts
    if (!account || account.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    accounts.delete(id);
    emailCache.delete(id);
    loadingStatus.delete(id);
    await db_1.default.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, userId]);
    await db_1.default.query('DELETE FROM tokens WHERE account_id = $1', [id]);
    res.json({ success: true });
});
// GET /api/v1/emails — returns first 50 immediately, kicks off background jobs
router.get('/emails', async (req, res) => {
    const userId = req.userId;
    const accountId = req.query.accountId;
    try {
        const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId);
        const targetAccounts = accountId
            ? userAccounts.filter((a) => a.id === accountId)
            : userAccounts;
        const allEmailsPromises = targetAccounts.map(async (account) => {
            if (account.provider === 'gmail') {
                const accessToken = await getFreshAccessToken(account);
                // Fast: one API call to get first 50 IDs
                const first50Ids = await gmailService.fetchFirstIds(accessToken, 50);
                const first50 = await gmailService.fetchEmailsByIds(accessToken, account.id, first50Ids);
                // Cache the first 50
                emailCache.set(account.id, first50);
                loadingStatus.set(account.id, { loading: true, total: first50.length, loaded: first50.length });
                // Background: fetch all remaining IDs and emails (skipping the first 50)
                (async () => {
                    try {
                        const remainingIds = await gmailService.fetchAllIds(accessToken, 50);
                        if (remainingIds.length > 0) {
                            const total = first50.length + remainingIds.length;
                            loadingStatus.set(account.id, { loading: true, total, loaded: first50.length });
                            await fetchEmailsInBackground(account, remainingIds);
                        }
                        else {
                            loadingStatus.set(account.id, { loading: false, total: first50.length, loaded: first50.length });
                        }
                    }
                    catch { }
                })();
                return first50;
            }
            else if (account.provider === 'office365') {
                const accessToken = await getFreshAccessToken(account);
                const first50Ids = await office365Service.fetchFirstIds(accessToken, 50);
                const first50 = await office365Service.fetchEmailsByIds(accessToken, account.id, first50Ids);
                emailCache.set(account.id, first50);
                loadingStatus.set(account.id, { loading: true, total: first50.length, loaded: first50.length });
                (async () => {
                    try {
                        const remainingIds = await office365Service.fetchAllIds(accessToken, 50);
                        if (remainingIds.length > 0) {
                            const total = first50.length + remainingIds.length;
                            loadingStatus.set(account.id, { loading: true, total, loaded: first50.length });
                            // fetch in chunks of 50
                            const CHUNK_SIZE = 50;
                            for (let i = 0; i < remainingIds.length; i += CHUNK_SIZE) {
                                const chunk = remainingIds.slice(i, i + CHUNK_SIZE);
                                const emails = await office365Service.fetchEmailsByIds(accessToken, account.id, chunk);
                                const existing = emailCache.get(account.id) || [];
                                const existingIds = new Set(existing.map((e) => e.id));
                                const unique = emails.filter((e) => !existingIds.has(e.id));
                                emailCache.set(account.id, [...existing, ...unique]);
                                const s = loadingStatus.get(account.id);
                                loadingStatus.set(account.id, { ...s, loaded: s.loaded + emails.length });
                            }
                        }
                        const s = loadingStatus.get(account.id);
                        loadingStatus.set(account.id, { ...s, loading: false });
                    }
                    catch { }
                })();
                return first50;
            }
            else {
                // IMAP (Yahoo, AOL, custom)
                return imapService.fetchEmails(getImapConfig(account), account.id, 50);
            }
        });
        const results = await Promise.allSettled(allEmailsPromises);
        const allEmails = results
            .filter((r) => r.status === 'fulfilled')
            .flatMap((r) => r.value);
        allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        res.json(allEmails);
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/emails/more — returns cached emails after offset (for polling)
router.get('/emails/more', (req, res) => {
    const userId = req.userId;
    const accountId = req.query.accountId;
    const offset = parseInt(req.query.offset) || 50;
    const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId);
    const targetAccounts = accountId
        ? userAccounts.filter((a) => a.id === accountId)
        : userAccounts;
    const allEmails = [];
    const status = {};
    for (const account of targetAccounts) {
        const cached = emailCache.get(account.id) || [];
        const newEmails = cached.slice(offset);
        allEmails.push(...newEmails);
        const s = loadingStatus.get(account.id);
        status[account.id] = s || { loading: false, total: cached.length, loaded: cached.length };
    }
    allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json({ emails: allEmails, status });
});
// GET /api/v1/emails/status — check background loading progress
router.get('/emails/status', (req, res) => {
    const userId = req.userId;
    const accountId = req.query.accountId;
    const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId);
    const targetAccounts = accountId
        ? userAccounts.filter((a) => a.id === accountId)
        : userAccounts;
    const status = {};
    for (const account of targetAccounts) {
        const s = loadingStatus.get(account.id);
        const cached = emailCache.get(account.id) || [];
        status[account.id] = s || { loading: false, total: cached.length, loaded: cached.length };
    }
    res.json(status);
});
// GET /api/v1/emails/search
router.get('/emails/search', async (req, res) => {
    const userId = req.userId;
    const query = req.query.query;
    const accountId = req.query.accountId;
    try {
        const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId);
        const targetAccounts = accountId
            ? userAccounts.filter((a) => a.id === accountId)
            : userAccounts;
        const results = await Promise.allSettled(targetAccounts.map(async (account) => {
            if (account.provider === 'gmail') {
                return gmailService.searchEmails(await getFreshAccessToken(account), account.id, query);
            }
            else if (account.provider === 'office365') {
                return office365Service.searchEmails(await getFreshAccessToken(account), account.id, query);
            }
            else {
                return imapService.searchEmails(getImapConfig(account), account.id, query);
            }
        }));
        const emails = results
            .filter((r) => r.status === 'fulfilled')
            .flatMap((r) => r.value);
        res.json(emails);
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/emails/send
router.post('/emails/send', async (req, res) => {
    const { accountId, ...payload } = req.body;
    const account = accounts.get(accountId);
    if (!account)
        return res.status(404).json({ error: 'Account not found' });
    try {
        if (account.provider === 'gmail') {
            await gmailService.sendEmail(await getFreshAccessToken(account), payload);
        }
        else if (account.provider === 'office365') {
            await office365Service.sendEmail(await getFreshAccessToken(account), payload);
        }
        else {
            await imapService.sendEmail(getImapConfig(account), payload);
        }
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/emails/:id/archive
router.post('/emails/:id/archive', async (req, res) => {
    const { accountId } = req.body;
    const account = accounts.get(accountId);
    if (!account)
        return res.status(404).json({ error: 'Account not found' });
    try {
        if (account.provider === 'gmail') {
            await gmailService.archiveEmail(await getFreshAccessToken(account), req.params.id);
        }
        else if (account.provider === 'office365') {
            await office365Service.archiveEmail(await getFreshAccessToken(account), req.params.id);
        }
        else {
            await imapService.archiveEmail(getImapConfig(account), req.params.id);
        }
        emailCache.set(accountId, (emailCache.get(accountId) || []).filter(e => e.id !== req.params.id));
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/emails/:id/delete
router.post('/emails/:id/delete', async (req, res) => {
    const { accountId } = req.body;
    const account = accounts.get(accountId);
    if (!account)
        return res.status(404).json({ error: 'Account not found' });
    try {
        if (account.provider === 'gmail') {
            await gmailService.deleteEmail(await getFreshAccessToken(account), req.params.id);
        }
        else if (account.provider === 'office365') {
            await office365Service.deleteEmail(await getFreshAccessToken(account), req.params.id);
        }
        else {
            await imapService.deleteEmail(getImapConfig(account), req.params.id);
        }
        emailCache.set(accountId, (emailCache.get(accountId) || []).filter(e => e.id !== req.params.id));
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/emails/:id/read
router.post('/emails/:id/read', async (req, res) => {
    const { accountId } = req.body;
    const account = accounts.get(accountId);
    if (!account)
        return res.status(404).json({ error: 'Account not found' });
    try {
        if (account.provider === 'gmail') {
            await gmailService.markAsRead(await getFreshAccessToken(account), req.params.id);
        }
        else if (account.provider === 'office365') {
            await office365Service.markAsRead(await getFreshAccessToken(account), req.params.id);
        }
        else {
            await imapService.markAsRead(getImapConfig(account), req.params.id);
        }
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/emails/labels — fetch all saved labels for this user
router.get('/emails/labels', async (req, res) => {
    const userId = req.userId;
    try {
        const { rows } = await db_1.default.query('SELECT email_id, label FROM email_labels WHERE user_id = $1', [userId]);
        res.json(rows);
    }
    catch (err) {
        logger_1.default.error('/emails/labels GET failed', { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/emails/:id/labels — save a label for an email
router.post('/emails/:id/labels', async (req, res) => {
    const userId = req.userId;
    const { label } = req.body;
    const emailId = req.params.id;
    try {
        await db_1.default.query('INSERT INTO email_labels (email_id, label, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [emailId, label, userId]);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error('/emails/:id/labels POST failed', { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/v1/emails/:id/labels/:label — remove a label from an email
router.delete('/emails/:id/labels/:label', async (req, res) => {
    const userId = req.userId;
    const emailId = req.params.id;
    const label = req.params.label;
    try {
        await db_1.default.query('DELETE FROM email_labels WHERE email_id = $1 AND label = $2 AND user_id = $3', [emailId, label, userId]);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.default.error('/emails/:id/labels DELETE failed', { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/ai/label — classify email into a label
router.post('/ai/label', async (req, res) => {
    const { subject, body } = req.body;
    try {
        const label = await aiService.classifyEmail(subject, body);
        res.json({ label });
    }
    catch (err) {
        logger_1.default.error('/ai/label failed', { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/ai/summarize
router.post('/ai/summarize', async (req, res) => {
    const { subject, body } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        for await (const chunk of aiService.summarizeEmailStream(subject, body)) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});
// POST /api/v1/ai/draft-reply
router.post('/ai/draft-reply', async (req, res) => {
    const { subject, body, fromName } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        for await (const chunk of aiService.draftReplyStream(subject, body, fromName)) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});
// POST /api/v1/ai/prioritize
router.post('/ai/prioritize', async (req, res) => {
    const { subject, body, from } = req.body;
    try {
        const score = await aiService.prioritizeEmail(subject, body, from);
        res.json({ score });
    }
    catch (err) {
        logger_1.default.error(req.path + " failed", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
