"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailService = void 0;
const googleapis_1 = require("googleapis");
class GmailService {
    getClient(accessToken) {
        const auth = new googleapis_1.google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        return googleapis_1.google.gmail({ version: 'v1', auth });
    }
    async fetchEmails(accessToken, accountId, maxResults = 0) {
        const gmail = this.getClient(accessToken);
        // Step 1: Fetch ALL message IDs (just IDs — very fast, no content)
        const allIds = [];
        let nextPageToken;
        do {
            const listRes = await gmail.users.messages.list({
                userId: 'me',
                maxResults: 500,
                labelIds: ['INBOX'],
                ...(nextPageToken && { pageToken: nextPageToken }),
            });
            const messages = listRes.data.messages || [];
            allIds.push(...messages.map((m) => m.id));
            nextPageToken = listRes.data.nextPageToken || undefined;
            if (maxResults > 0 && allIds.length >= maxResults)
                break;
        } while (nextPageToken);
        const idsToFetch = maxResults > 0 ? allIds.slice(0, maxResults) : allIds;
        // Step 2: Fetch full details for all emails in parallel (all at once)
        const emails = await Promise.all(idsToFetch.map(async (id) => {
            try {
                const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
                return this.parseGmailMessage(detail.data, accountId);
            }
            catch {
                return null;
            }
        }));
        return emails.filter(Boolean);
    }
    parseGmailMessage(msg, accountId) {
        const headers = msg.payload?.headers || [];
        const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        const from = this.parseEmailAddress(getHeader('From'));
        const toRaw = getHeader('To');
        const to = toRaw.split(',').map((t) => this.parseEmailAddress(t.trim()));
        const body = this.extractBody(msg.payload);
        return {
            id: msg.id,
            accountId,
            provider: 'gmail',
            from,
            to,
            subject: getHeader('Subject') || '(No Subject)',
            body: body.html || body.text,
            bodyText: body.text,
            date: new Date(parseInt(msg.internalDate)).toISOString(),
            read: !msg.labelIds?.includes('UNREAD'),
            starred: msg.labelIds?.includes('STARRED') || false,
            labels: msg.labelIds || [],
            hasAttachments: msg.payload?.parts?.some((p) => p.filename) || false,
            threadId: msg.threadId,
        };
    }
    parseEmailAddress(raw) {
        const match = raw.match(/^(.*?)\s*<(.+?)>$/);
        if (match)
            return { name: match[1].replace(/"/g, '').trim(), email: match[2] };
        return { name: raw, email: raw };
    }
    extractBody(payload) {
        let html = '';
        let text = '';
        const decode = (data) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
        const extract = (part) => {
            if (part.mimeType === 'text/html' && part.body?.data)
                html = decode(part.body.data);
            if (part.mimeType === 'text/plain' && part.body?.data)
                text = decode(part.body.data);
            if (part.parts)
                part.parts.forEach(extract);
        };
        extract(payload);
        return { html, text };
    }
    // Fast: single API call, returns first `count` IDs only
    async fetchFirstIds(accessToken, count = 50) {
        const gmail = this.getClient(accessToken);
        const res = await gmail.users.messages.list({
            userId: 'me',
            maxResults: count,
            labelIds: ['INBOX'],
        });
        return (res.data.messages || []).map((m) => m.id);
    }
    // Slow: paginates through everything — used only in background
    async fetchAllIds(accessToken, skipFirst = 0) {
        const gmail = this.getClient(accessToken);
        const allIds = [];
        let nextPageToken;
        let fetched = 0;
        do {
            const listRes = await gmail.users.messages.list({
                userId: 'me',
                maxResults: 500,
                labelIds: ['INBOX'],
                ...(nextPageToken && { pageToken: nextPageToken }),
            });
            const messages = listRes.data.messages || [];
            fetched += messages.length;
            // skip the first `skipFirst` IDs (already shown to user)
            if (fetched > skipFirst) {
                const startIdx = Math.max(0, skipFirst - (fetched - messages.length));
                allIds.push(...messages.slice(startIdx).map((m) => m.id));
            }
            nextPageToken = listRes.data.nextPageToken || undefined;
        } while (nextPageToken);
        return allIds;
    }
    async fetchEmailsByIds(accessToken, accountId, ids) {
        const gmail = this.getClient(accessToken);
        const emails = await Promise.all(ids.map(async (id) => {
            try {
                const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
                return this.parseGmailMessage(detail.data, accountId);
            }
            catch {
                return null;
            }
        }));
        return emails.filter(Boolean);
    }
    async sendEmail(accessToken, payload) {
        const gmail = this.getClient(accessToken);
        const messageParts = [
            `To: ${payload.to}`,
            payload.cc ? `Cc: ${payload.cc}` : '',
            `Subject: ${payload.subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            payload.body,
        ].filter(Boolean);
        const raw = Buffer.from(messageParts.join('\r\n'))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    }
    async archiveEmail(accessToken, emailId) {
        const gmail = this.getClient(accessToken);
        await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: { removeLabelIds: ['INBOX'] },
        });
    }
    async deleteEmail(accessToken, emailId) {
        const gmail = this.getClient(accessToken);
        await gmail.users.messages.trash({ userId: 'me', id: emailId });
    }
    async markAsRead(accessToken, emailId) {
        const gmail = this.getClient(accessToken);
        await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: { removeLabelIds: ['UNREAD'] },
        });
    }
    async searchEmails(accessToken, accountId, query) {
        const gmail = this.getClient(accessToken);
        const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
        const messages = res.data.messages || [];
        const emails = await Promise.all(messages.map(async (msg) => {
            try {
                const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
                return this.parseGmailMessage(detail.data, accountId);
            }
            catch {
                return null;
            }
        }));
        return emails.filter(Boolean);
    }
}
exports.GmailService = GmailService;
