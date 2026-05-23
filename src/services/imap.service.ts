import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import { simpleParser, ParsedMail } from 'mailparser';
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

  private getProvider(host: string): string {
    if (host.includes('yahoo')) return 'yahoo';
    if (host.includes('aol')) return 'aol';
    return 'imap';
  }

  // Try common archive/trash folder names across providers
  private async findFolder(client: ImapFlow, names: string[]): Promise<string | null> {
    const list = await client.list();
    for (const name of names) {
      const found = list.find(
        (f) => f.name.toLowerCase() === name.toLowerCase() ||
               f.path.toLowerCase() === name.toLowerCase()
      );
      if (found) return found.path;
    }
    return null;
  }

  async fetchEmails(config: ImapConfig, accountId: string, maxResults = 50): Promise<Email[]> {
    const client = await this.getClient(config);
    const emails: Email[] = [];

    try {
      await client.mailboxOpen('INBOX');
      const status = await client.status('INBOX', { messages: true });
      const total = status.messages ?? 0;
      const start = Math.max(1, total - maxResults + 1);

      const messages = client.fetch(`${start}:*`, { source: true, flags: true, uid: true });

      for await (const msg of messages) {
        try {
          if (!msg.source) continue;
          const parsed: ParsedMail = await (simpleParser as any)(msg.source);
          const from = parsed.from?.value?.[0]
            ? { name: parsed.from.value[0].name || '', email: parsed.from.value[0].address || '' }
            : { name: '', email: '' };

          const to = (parsed.to
            ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                .flatMap((a: any) => a.value || [])
                .map((a: any) => ({ name: a.name || '', email: a.address || '' }))
            : []);

          emails.push({
            id: `${accountId}-${msg.uid}`,
            accountId,
            provider: this.getProvider(config.host) as any,
            from,
            to,
            subject: parsed.subject || '(No Subject)',
            body: (parsed.html as string) || parsed.textAsHtml || parsed.text || '',
            bodyText: parsed.text || '',
            date: parsed.date?.toISOString() || new Date().toISOString(),
            read: msg.flags?.has('\\Seen') || false,
            starred: msg.flags?.has('\\Flagged') || false,
            labels: [],
            hasAttachments: (parsed.attachments?.length || 0) > 0,
          });
        } catch {
          // skip malformed
        }
      }
    } finally {
      await client.logout();
    }

    return emails.reverse().slice(0, maxResults);
  }

  async archiveEmail(config: ImapConfig, emailUid: string): Promise<void> {
    const uid = emailUid.split('-').pop()!;
    const client = await this.getClient(config);
    try {
      await client.mailboxOpen('INBOX');
      const archiveFolder = await this.findFolder(client, ['Archive', 'Archived', '[Gmail]/All Mail', 'Bulk Mail']);
      if (archiveFolder) {
        await client.messageMove(uid, archiveFolder, { uid: true });
      } else {
        // Fallback: just mark as read and remove from inbox via delete
        await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
        await client.mailboxClose();
      }
    } finally {
      await client.logout();
    }
  }

  async deleteEmail(config: ImapConfig, emailUid: string): Promise<void> {
    const uid = emailUid.split('-').pop()!;
    const client = await this.getClient(config);
    try {
      await client.mailboxOpen('INBOX');
      const trashFolder = await this.findFolder(client, ['Trash', 'Deleted', 'Deleted Items', '[Gmail]/Trash']);
      if (trashFolder) {
        await client.messageMove(uid, trashFolder, { uid: true });
      } else {
        await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
        await client.mailboxClose();
      }
    } finally {
      await client.logout();
    }
  }

  async markAsRead(config: ImapConfig, emailUid: string): Promise<void> {
    const uid = emailUid.split('-').pop()!;
    const client = await this.getClient(config);
    try {
      await client.mailboxOpen('INBOX');
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    } finally {
      await client.logout();
    }
  }

  async sendEmail(config: ImapConfig, payload: ComposePayload): Promise<void> {
    const isYahoo = config.host.includes('yahoo');
    const isAol = config.host.includes('aol');

    let smtpHost = config.host.replace('imap.mail.', 'smtp.mail.').replace('imap.', 'smtp.');
    if (isYahoo) smtpHost = 'smtp.mail.yahoo.com';
    if (isAol) smtpHost = 'smtp.aol.com';

    const transporter = createTransport({
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

  async searchEmails(config: ImapConfig, accountId: string, query: string): Promise<Email[]> {
    const client = await this.getClient(config);
    const emails: Email[] = [];

    try {
      await client.mailboxOpen('INBOX');
      const uids = await client.search({ or: [{ body: query }, { subject: query }] });
      if (!uids || uids.length === 0) return [];

      const messages = client.fetch(uids.slice(-20), { source: true, flags: true, uid: true });

      for await (const msg of messages) {
        try {
          if (!msg.source) continue;
          const parsed: ParsedMail = await (simpleParser as any)(msg.source);
          const from = parsed.from?.value?.[0]
            ? { name: parsed.from.value[0].name || '', email: parsed.from.value[0].address || '' }
            : { name: '', email: '' };

          emails.push({
            id: `${accountId}-${msg.uid}`,
            accountId,
            provider: this.getProvider(config.host) as any,
            from,
            to: [],
            subject: parsed.subject || '(No Subject)',
            body: (parsed.html as string) || parsed.text || '',
            bodyText: parsed.text || '',
            date: parsed.date?.toISOString() || new Date().toISOString(),
            read: msg.flags?.has('\\Seen') || false,
            starred: msg.flags?.has('\\Flagged') || false,
            labels: [],
            hasAttachments: (parsed.attachments?.length || 0) > 0,
          });
        } catch {}
      }
    } finally {
      await client.logout();
    }

    return emails;
  }
}
