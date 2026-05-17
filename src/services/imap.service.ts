import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import { Email, ComposePayload } from '../types/email.types';

interface ImapConfig {
  host: string;
  port: number;
  email: string;
  password: string;
}

export class ImapService {
  private async getClient(config: ImapConfig): Promise<ImapFlow> {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: { user: config.email, pass: config.password },
      logger: false,
    });
    await client.connect();
    return client;
  }

  async fetchEmails(config: ImapConfig, accountId: string, maxResults = 50): Promise<Email[]> {
    const client = await this.getClient(config);
    const emails: Email[] = [];

    try {
      await client.mailboxOpen('INBOX');

      const status = await client.status('INBOX', { messages: true });
      const total = status.messages ?? 0;
      const start = Math.max(1, total - maxResults + 1);
      const messages = client.fetch(`${start}:*`, {
        envelope: true,
        bodyStructure: true,
        source: true,
        flags: true,
      });

      for await (const msg of messages) {
        try {
          const email = await this.parseImapMessage(msg, accountId, config);
          if (email) emails.push(email);
        } catch {
          // skip malformed messages
        }
      }
    } finally {
      await client.logout();
    }

    return emails.reverse().slice(0, maxResults);
  }

  private async parseImapMessage(msg: any, accountId: string, config: ImapConfig): Promise<Email | null> {
    const envelope = msg.envelope;
    if (!envelope) return null;

    const from = envelope.from?.[0]
      ? { name: envelope.from[0].name || '', email: `${envelope.from[0].mailbox}@${envelope.from[0].host}` }
      : { name: '', email: '' };

    const to = (envelope.to || []).map((t: any) => ({
      name: t.name || '',
      email: `${t.mailbox}@${t.host}`,
    }));

    const source = msg.source?.toString('utf-8') || '';
    const bodyText = this.extractTextFromRaw(source);

    const provider = config.host.includes('yahoo') ? 'imap' :
      config.host.includes('aol') ? 'imap' : 'imap';

    return {
      id: `${accountId}-${msg.uid}`,
      accountId,
      provider,
      from,
      to,
      subject: envelope.subject || '(No Subject)',
      body: bodyText,
      bodyText,
      date: envelope.date?.toISOString() || new Date().toISOString(),
      read: msg.flags?.has('\\Seen') || false,
      starred: msg.flags?.has('\\Flagged') || false,
      labels: [],
      hasAttachments: false,
    };
  }

  private extractTextFromRaw(raw: string): string {
    const parts = raw.split(/\r?\n\r?\n/);
    return parts.slice(1).join('\n\n').substring(0, 2000);
  }

  async sendEmail(config: ImapConfig, payload: ComposePayload): Promise<void> {
    const smtpHost = config.host.replace('imap.', 'smtp.');
    const transporter = createTransport({
      host: smtpHost,
      port: 587,
      secure: false,
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

  async searchEmails(config: ImapConfig, accountId: string, query: string): Promise<Email[]> {
    const client = await this.getClient(config);
    const emails: Email[] = [];

    try {
      await client.mailboxOpen('INBOX');
      const uids = await client.search({ body: query });
      const uidArray = Array.isArray(uids) ? uids : [];

      if (uidArray.length === 0) return [];

      const messages = client.fetch(uidArray.slice(0, 20), {
        envelope: true,
        source: true,
        flags: true,
      });

      for await (const msg of messages) {
        const email = await this.parseImapMessage(msg, accountId, config);
        if (email) emails.push(email);
      }
    } finally {
      await client.logout();
    }

    return emails;
  }
}
