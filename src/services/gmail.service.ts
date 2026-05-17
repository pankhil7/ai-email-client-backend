import { google } from 'googleapis';
import { Email, ComposePayload } from '../types/email.types';

export class GmailService {
  private getClient(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.gmail({ version: 'v1', auth });
  }

  async fetchEmails(accessToken: string, accountId: string, maxResults = 100, pageToken?: string): Promise<Email[]> {
    const gmail = this.getClient(accessToken);
    const allEmails: Email[] = [];
    let nextPageToken: string | undefined = pageToken;
    let fetched = 0;

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults - fetched, 500),
        labelIds: ['INBOX'],
        ...(nextPageToken && { pageToken: nextPageToken }),
      });

      const messages = listRes.data.messages || [];
      nextPageToken = listRes.data.nextPageToken || undefined;

      const emails = await Promise.all(
        messages.map(async (msg) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'full',
          });
          return this.parseGmailMessage(detail.data, accountId);
        })
      );

      allEmails.push(...(emails.filter(Boolean) as Email[]));
      fetched += messages.length;

    } while (nextPageToken && fetched < maxResults);

    return allEmails;
  }

  private parseGmailMessage(msg: any, accountId: string): Email {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = this.parseEmailAddress(getHeader('From'));
    const toRaw = getHeader('To');
    const to = toRaw.split(',').map((t: string) => this.parseEmailAddress(t.trim()));

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
      hasAttachments: msg.payload?.parts?.some((p: any) => p.filename) || false,
      threadId: msg.threadId,
    };
  }

  private parseEmailAddress(raw: string): { name: string; email: string } {
    const match = raw.match(/^(.*?)\s*<(.+?)>$/);
    if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2] };
    return { name: raw, email: raw };
  }

  private extractBody(payload: any): { html: string; text: string } {
    let html = '';
    let text = '';

    const decode = (data: string) =>
      Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

    const extract = (part: any) => {
      if (part.mimeType === 'text/html' && part.body?.data) html = decode(part.body.data);
      if (part.mimeType === 'text/plain' && part.body?.data) text = decode(part.body.data);
      if (part.parts) part.parts.forEach(extract);
    };

    extract(payload);
    return { html, text };
  }

  async sendEmail(accessToken: string, payload: ComposePayload): Promise<void> {
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

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
  }

  async archiveEmail(accessToken: string, emailId: string): Promise<void> {
    const gmail = this.getClient(accessToken);
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
  }

  async deleteEmail(accessToken: string, emailId: string): Promise<void> {
    const gmail = this.getClient(accessToken);
    await gmail.users.messages.trash({ userId: 'me', id: emailId });
  }

  async markAsRead(accessToken: string, emailId: string): Promise<void> {
    const gmail = this.getClient(accessToken);
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  async searchEmails(accessToken: string, accountId: string, query: string): Promise<Email[]> {
    const gmail = this.getClient(accessToken);
    const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
    const messages = res.data.messages || [];

    const emails = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        return this.parseGmailMessage(detail.data, accountId);
      })
    );

    return emails.filter(Boolean) as Email[];
  }
}
