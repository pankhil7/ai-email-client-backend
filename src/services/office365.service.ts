import axios from 'axios';
import { Email, ComposePayload } from '../types/email.types';

export class Office365Service {
  private async get(accessToken: string, path: string, params: Record<string, string> = {}) {
    const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.data;
  }

  private async post(accessToken: string, path: string, body: any) {
    const res = await axios.post(`https://graph.microsoft.com/v1.0${path}`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return res.data;
  }

  private async patch(accessToken: string, path: string, body: any) {
    await axios.patch(`https://graph.microsoft.com/v1.0${path}`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
  }

  private async delete(accessToken: string, path: string) {
    await axios.delete(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private parseMessage(msg: any, accountId: string): Email {
    const from = {
      name: msg.from?.emailAddress?.name || '',
      email: msg.from?.emailAddress?.address || '',
    };
    const to = (msg.toRecipients || []).map((r: any) => ({
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

  async fetchFirstIds(accessToken: string, count = 50): Promise<string[]> {
    const data = await this.get(accessToken, '/me/mailFolders/inbox/messages', {
      $select: 'id',
      $top: String(count),
      $orderby: 'receivedDateTime desc',
    });
    return (data.value || []).map((m: any) => m.id as string);
  }

  async fetchAllIds(accessToken: string, skipFirst = 0): Promise<string[]> {
    const allIds: string[] = [];
    let url: string | null = `/me/mailFolders/inbox/messages?$select=id&$top=100&$orderby=receivedDateTime desc&$skip=${skipFirst}`;

    while (url) {
      const data = await this.get(accessToken, url.startsWith('https') ? '' : url);
      const msgs = data.value || [];
      allIds.push(...msgs.map((m: any) => m.id as string));
      url = data['@odata.nextLink'] || null;
    }

    return allIds;
  }

  async fetchEmailsByIds(accessToken: string, accountId: string, ids: string[]): Promise<Email[]> {
    const emails = await Promise.all(
      ids.map(async (id) => {
        try {
          const msg = await this.get(accessToken, `/me/messages/${id}`, {
            $select: 'id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,isRead,flag,hasAttachments,conversationId,categories',
          });
          return this.parseMessage(msg, accountId);
        } catch {
          return null;
        }
      })
    );
    return emails.filter(Boolean) as Email[];
  }

  async sendEmail(accessToken: string, payload: ComposePayload): Promise<void> {
    await this.post(accessToken, '/me/sendMail', {
      message: {
        subject: payload.subject,
        body: { contentType: 'HTML', content: payload.body },
        toRecipients: [{ emailAddress: { address: payload.to } }],
        ...(payload.cc && { ccRecipients: [{ emailAddress: { address: payload.cc } }] }),
      },
    });
  }

  async archiveEmail(accessToken: string, emailId: string): Promise<void> {
    await this.post(accessToken, `/me/messages/${emailId}/move`, {
      destinationId: 'archive',
    });
  }

  async deleteEmail(accessToken: string, emailId: string): Promise<void> {
    await this.delete(accessToken, `/me/messages/${emailId}`);
  }

  async markAsRead(accessToken: string, emailId: string): Promise<void> {
    await this.patch(accessToken, `/me/messages/${emailId}`, { isRead: true });
  }

  async searchEmails(accessToken: string, accountId: string, query: string): Promise<Email[]> {
    const data = await this.get(accessToken, '/me/messages', {
      $search: `"${query}"`,
      $top: '20',
      $select: 'id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,isRead,flag,hasAttachments,conversationId',
    });
    return (data.value || []).map((msg: any) => this.parseMessage(msg, accountId));
  }

  async getUserEmail(accessToken: string): Promise<string> {
    const data = await this.get(accessToken, '/me', { $select: 'mail,userPrincipalName' });
    return data.mail || data.userPrincipalName || '';
  }
}
