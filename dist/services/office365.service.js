"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Office365Service = void 0;
const axios_1 = __importDefault(require("axios"));
class Office365Service {
    async get(accessToken, path, params = {}) {
        const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const res = await axios_1.default.get(url.toString(), {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return res.data;
    }
    async post(accessToken, path, body) {
        const res = await axios_1.default.post(`https://graph.microsoft.com/v1.0${path}`, body, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });
        return res.data;
    }
    async patch(accessToken, path, body) {
        await axios_1.default.patch(`https://graph.microsoft.com/v1.0${path}`, body, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });
    }
    async delete(accessToken, path) {
        await axios_1.default.delete(`https://graph.microsoft.com/v1.0${path}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }
    parseMessage(msg, accountId) {
        const from = {
            name: msg.from?.emailAddress?.name || '',
            email: msg.from?.emailAddress?.address || '',
        };
        const to = (msg.toRecipients || []).map((r) => ({
            name: r.emailAddress?.name || '',
            email: r.emailAddress?.address || '',
        }));
        return {
            id: msg.id,
            accountId,
            provider: 'office365',
            from,
            to,
            subject: msg.subject || '(No Subject)',
            body: msg.body?.content || msg.bodyPreview || '',
            bodyText: msg.bodyPreview || '',
            date: msg.receivedDateTime || new Date().toISOString(),
            read: msg.isRead || false,
            starred: msg.flag?.flagStatus === 'flagged',
            labels: msg.categories || [],
            hasAttachments: msg.hasAttachments || false,
            threadId: msg.conversationId,
        };
    }
    async fetchFirstIds(accessToken, count = 50) {
        const data = await this.get(accessToken, '/me/mailFolders/inbox/messages', {
            $select: 'id',
            $top: String(count),
            $orderby: 'receivedDateTime desc',
        });
        return (data.value || []).map((m) => m.id);
    }
    async fetchAllIds(accessToken, skipFirst = 0) {
        const allIds = [];
        let url = `/me/mailFolders/inbox/messages?$select=id&$top=100&$orderby=receivedDateTime desc&$skip=${skipFirst}`;
        while (url) {
            const data = await this.get(accessToken, url.startsWith('https') ? '' : url);
            const msgs = data.value || [];
            allIds.push(...msgs.map((m) => m.id));
            url = data['@odata.nextLink'] || null;
        }
        return allIds;
    }
    async fetchEmailsByIds(accessToken, accountId, ids) {
        const emails = await Promise.all(ids.map(async (id) => {
            try {
                const msg = await this.get(accessToken, `/me/messages/${id}`, {
                    $select: 'id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,isRead,flag,hasAttachments,conversationId,categories',
                });
                return this.parseMessage(msg, accountId);
            }
            catch {
                return null;
            }
        }));
        return emails.filter(Boolean);
    }
    async sendEmail(accessToken, payload) {
        await this.post(accessToken, '/me/sendMail', {
            message: {
                subject: payload.subject,
                body: { contentType: 'HTML', content: payload.body },
                toRecipients: [{ emailAddress: { address: payload.to } }],
                ...(payload.cc && { ccRecipients: [{ emailAddress: { address: payload.cc } }] }),
            },
        });
    }
    async archiveEmail(accessToken, emailId) {
        await this.post(accessToken, `/me/messages/${emailId}/move`, {
            destinationId: 'archive',
        });
    }
    async deleteEmail(accessToken, emailId) {
        await this.delete(accessToken, `/me/messages/${emailId}`);
    }
    async markAsRead(accessToken, emailId) {
        await this.patch(accessToken, `/me/messages/${emailId}`, { isRead: true });
    }
    async searchEmails(accessToken, accountId, query) {
        const data = await this.get(accessToken, '/me/messages', {
            $search: `"${query}"`,
            $top: '20',
            $select: 'id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,isRead,flag,hasAttachments,conversationId',
        });
        return (data.value || []).map((msg) => this.parseMessage(msg, accountId));
    }
    async getUserEmail(accessToken) {
        const data = await this.get(accessToken, '/me', { $select: 'mail,userPrincipalName' });
        return data.mail || data.userPrincipalName || '';
    }
}
exports.Office365Service = Office365Service;
