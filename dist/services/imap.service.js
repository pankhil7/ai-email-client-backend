"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImapService = void 0;
const imapflow_1 = require("imapflow");
const nodemailer_1 = require("nodemailer");
const mailparser_1 = require("mailparser");
class ImapService {
    async getClient(config) {
        const client = new imapflow_1.ImapFlow({
            host: config.host,
            port: config.port,
            secure: config.port === 993,
            auth: { user: config.email, pass: config.password },
            logger: false,
        });
        await client.connect();
        return client;
    }
    getProvider(host) {
        if (host.includes('yahoo'))
            return 'yahoo';
        if (host.includes('aol'))
            return 'aol';
        return 'imap';
    }
    // Try common archive/trash folder names across providers
    async findFolder(client, names) {
        const list = await client.list();
        for (const name of names) {
            const found = list.find((f) => f.name.toLowerCase() === name.toLowerCase() ||
                f.path.toLowerCase() === name.toLowerCase());
            if (found)
                return found.path;
        }
        return null;
    }
    async fetchEmails(config, accountId, maxResults = 50) {
        const client = await this.getClient(config);
        const emails = [];
        try {
            await client.mailboxOpen('INBOX');
            const status = await client.status('INBOX', { messages: true });
            const total = status.messages ?? 0;
            const start = Math.max(1, total - maxResults + 1);
            const messages = client.fetch(`${start}:*`, { source: true, flags: true, uid: true });
            for await (const msg of messages) {
                try {
                    if (!msg.source)
                        continue;
                    const parsed = await mailparser_1.simpleParser(msg.source);
                    const from = parsed.from?.value?.[0]
                        ? { name: parsed.from.value[0].name || '', email: parsed.from.value[0].address || '' }
                        : { name: '', email: '' };
                    const to = (parsed.to
                        ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                            .flatMap((a) => a.value || [])
                            .map((a) => ({ name: a.name || '', email: a.address || '' }))
                        : []);
                    emails.push({
                        id: `${accountId}-${msg.uid}`,
                        accountId,
                        provider: this.getProvider(config.host),
                        from,
                        to,
                        subject: parsed.subject || '(No Subject)',
                        body: parsed.html || parsed.textAsHtml || parsed.text || '',
                        bodyText: parsed.text || '',
                        date: parsed.date?.toISOString() || new Date().toISOString(),
                        read: msg.flags?.has('\\Seen') || false,
                        starred: msg.flags?.has('\\Flagged') || false,
                        labels: [],
                        hasAttachments: (parsed.attachments?.length || 0) > 0,
                    });
                }
                catch {
                    // skip malformed
                }
            }
        }
        finally {
            await client.logout();
        }
        return emails.reverse().slice(0, maxResults);
    }
    async archiveEmail(config, emailUid) {
        const uid = emailUid.split('-').pop();
        const client = await this.getClient(config);
        try {
            await client.mailboxOpen('INBOX');
            const archiveFolder = await this.findFolder(client, ['Archive', 'Archived', '[Gmail]/All Mail', 'Bulk Mail']);
            if (archiveFolder) {
                await client.messageMove(uid, archiveFolder, { uid: true });
            }
            else {
                // Fallback: just mark as read and remove from inbox via delete
                await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
                await client.mailboxClose();
            }
        }
        finally {
            await client.logout();
        }
    }
    async deleteEmail(config, emailUid) {
        const uid = emailUid.split('-').pop();
        const client = await this.getClient(config);
        try {
            await client.mailboxOpen('INBOX');
            const trashFolder = await this.findFolder(client, ['Trash', 'Deleted', 'Deleted Items', '[Gmail]/Trash']);
            if (trashFolder) {
                await client.messageMove(uid, trashFolder, { uid: true });
            }
            else {
                await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
                await client.mailboxClose();
            }
        }
        finally {
            await client.logout();
        }
    }
    async markAsRead(config, emailUid) {
        const uid = emailUid.split('-').pop();
        const client = await this.getClient(config);
        try {
            await client.mailboxOpen('INBOX');
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        }
        finally {
            await client.logout();
        }
    }
    async sendEmail(config, payload) {
        const isYahoo = config.host.includes('yahoo');
        const isAol = config.host.includes('aol');
        let smtpHost = config.host.replace('imap.mail.', 'smtp.mail.').replace('imap.', 'smtp.');
        if (isYahoo)
            smtpHost = 'smtp.mail.yahoo.com';
        if (isAol)
            smtpHost = 'smtp.aol.com';
        const transporter = (0, nodemailer_1.createTransport)({
            host: smtpHost,
            port: 465,
            secure: true,
            auth: { user: config.email, pass: config.password },
        });
        await transporter.sendMail({
            from: config.email,
            to: payload.to,
            cc: payload.cc,
            subject: payload.subject,
            html: payload.body,
        });
    }
    async searchEmails(config, accountId, query) {
        const client = await this.getClient(config);
        const emails = [];
        try {
            await client.mailboxOpen('INBOX');
            const uids = await client.search({ or: [{ body: query }, { subject: query }] });
            if (!uids || uids.length === 0)
                return [];
            const messages = client.fetch(uids.slice(-20), { source: true, flags: true, uid: true });
            for await (const msg of messages) {
                try {
                    if (!msg.source)
                        continue;
                    const parsed = await mailparser_1.simpleParser(msg.source);
                    const from = parsed.from?.value?.[0]
                        ? { name: parsed.from.value[0].name || '', email: parsed.from.value[0].address || '' }
                        : { name: '', email: '' };
                    emails.push({
                        id: `${accountId}-${msg.uid}`,
                        accountId,
                        provider: this.getProvider(config.host),
                        from,
                        to: [],
                        subject: parsed.subject || '(No Subject)',
                        body: parsed.html || parsed.text || '',
                        bodyText: parsed.text || '',
                        date: parsed.date?.toISOString() || new Date().toISOString(),
                        read: msg.flags?.has('\\Seen') || false,
                        starred: msg.flags?.has('\\Flagged') || false,
                        labels: [],
                        hasAttachments: (parsed.attachments?.length || 0) > 0,
                    });
                }
                catch { }
            }
        }
        finally {
            await client.logout();
        }
        return emails;
    }
}
exports.ImapService = ImapService;
