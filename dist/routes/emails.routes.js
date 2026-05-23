"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gmail_service_1 = require("../services/gmail.service");
const imap_service_1 = require("../services/imap.service");
const office365_service_1 = require("../services/office365.service");
const ai_service_1 = require("../services/ai.service");
const auth_routes_1 = require("./auth.routes");
const googleapis_1 = require("googleapis");
const axios_1 = __importDefault(require("axios"));
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
const gmailService = new gmail_service_1.GmailService();
const imapService = new imap_service_1.ImapService();
const office365Service = new office365_service_1.Office365Service();
const aiService = new ai_service_1.AIService();
// In-memory cache loaded from SQLite on startup
const accounts = new Map();
// Load persisted accounts from DB into memory
db_1.default.prepare('SELECT * FROM accounts').all().forEach((row) => {
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
    });
});
// Email cache: accountId -> Email[]
const emailCache = new Map();
// Loading status per account: accountId -> { loading, total, loaded }
const loadingStatus = new Map();
async function getFreshAccessToken(account) {
    const stored = auth_routes_1.tokenStore.get(account.id);
    const refreshToken = stored?.refreshToken || account.refreshToken || '';
    if (account.provider === 'gmail') {
        try {
            const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await oauth2Client.refreshAccessToken();
            const newToken = credentials.access_token || '';
            // Update store and DB
            auth_routes_1.tokenStore.set(account.id, { ...stored, accessToken: newToken });
            db_1.default.prepare('UPDATE tokens SET access_token = ? WHERE account_id = ?').run(newToken, account.id);
            return newToken;
        }
        catch {
            return stored?.accessToken || '';
        }
    }
    if (account.provider === 'office365') {
        try {
            const res = await axios_1.default.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID,
                client_secret: process.env.MICROSOFT_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            const newToken = res.data.access_token || '';
            auth_routes_1.tokenStore.set(account.id, { ...stored, accessToken: newToken });
            db_1.default.prepare('UPDATE tokens SET access_token = ? WHERE account_id = ?').run(newToken, account.id);
            return newToken;
        }
        catch {
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
        catch {
            // skip failed chunk, continue
        }
    }
    const status = loadingStatus.get(accountId);
    loadingStatus.set(accountId, { ...status, loading: false });
}
// POST /api/v1/accounts
router.post('/accounts', (req, res) => {
    const { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color } = req.body;
    const account = { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color };
    accounts.set(id, account);
    // Persist to SQLite
    db_1.default.prepare(`
    INSERT INTO accounts (id, email, provider, access_token, refresh_token, imap_host, imap_port, imap_password, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email=excluded.email, provider=excluded.provider,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      imap_host=excluded.imap_host, imap_port=excluded.imap_port,
      imap_password=excluded.imap_password, color=excluded.color
  `).run(id, email, provider, accessToken ?? null, refreshToken ?? null, imapHost ?? null, imapPort ?? null, imapPassword ?? null, color ?? null);
    // Clear old cache when account is re-added
    emailCache.delete(id);
    loadingStatus.delete(id);
    res.json({ success: true, accountId: id });
});
// GET /api/v1/accounts
router.get('/accounts', (_req, res) => {
    res.json(Array.from(accounts.values()).map(({ imapPassword, accessToken, ...safe }) => safe));
});
// DELETE /api/v1/accounts/:id
router.delete('/accounts/:id', (req, res) => {
    const id = req.params.id;
    accounts.delete(id);
    emailCache.delete(id);
    loadingStatus.delete(id);
    db_1.default.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    db_1.default.prepare('DELETE FROM tokens WHERE account_id = ?').run(id);
    res.json({ success: true });
});
// GET /api/v1/emails — returns first 50 immediately, kicks off background jobs
router.get('/emails', async (req, res) => {
    const accountId = req.query.accountId;
    try {
        const targetAccounts = accountId
            ? [accounts.get(accountId)].filter(Boolean)
            : Array.from(accounts.values());
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
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/emails/more — returns cached emails after offset (for polling)
router.get('/emails/more', (req, res) => {
    const accountId = req.query.accountId;
    const offset = parseInt(req.query.offset) || 50;
    const targetAccounts = accountId
        ? [accounts.get(accountId)].filter(Boolean)
        : Array.from(accounts.values());
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
    const accountId = req.query.accountId;
    const targetAccounts = accountId
        ? [accounts.get(accountId)].filter(Boolean)
        : Array.from(accounts.values());
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
    const query = req.query.query;
    const accountId = req.query.accountId;
    try {
        const targetAccounts = accountId
            ? [accounts.get(accountId)].filter(Boolean)
            : Array.from(accounts.values());
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
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
