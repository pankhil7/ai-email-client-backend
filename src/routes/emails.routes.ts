import { Router, Request, Response } from 'express';
import { GmailService } from '../services/gmail.service';
import { ImapService } from '../services/imap.service';
import { AIService } from '../services/ai.service';
import { tokenStore } from './auth.routes';

const router = Router();
const gmailService = new GmailService();
const imapService = new ImapService();
const aiService = new AIService();

// In-memory account store (in production, use a database)
const accounts: Map<string, any> = new Map();

// Helper: get access token for gmail account
function getAccessToken(account: any): string {
  if (account.provider === 'gmail') {
    const stored = tokenStore.get(account.id);
    return stored?.accessToken || account.accessToken || '';
  }
  return account.accessToken || '';
}

// POST /api/v1/accounts — register an account
router.post('/accounts', (req: Request, res: Response) => {
  const { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color } = req.body;
  accounts.set(id, { id, email, provider, accessToken, refreshToken, imapHost, imapPort, imapPassword, color });
  res.json({ success: true, accountId: id });
});

// GET /api/v1/accounts — list accounts
router.get('/accounts', (_req: Request, res: Response) => {
  res.json(Array.from(accounts.values()).map(({ imapPassword, accessToken, ...safe }) => safe));
});

// DELETE /api/v1/accounts/:id
router.delete('/accounts/:id', (req: Request, res: Response) => {
  accounts.delete(req.params.id as string);
  res.json({ success: true });
});

// GET /api/v1/emails — fetch unified inbox
router.get('/emails', async (req: Request, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  const maxResults = parseInt(req.query.maxResults as string) || 0; // 0 = fetch all
  const pageToken = req.query.pageToken as string | undefined;

  try {
    const targetAccounts = accountId
      ? [accounts.get(accountId)].filter(Boolean)
      : Array.from(accounts.values());

    const allEmailsPromises = targetAccounts.map(async (account) => {
      if (account.provider === 'gmail') {
        return gmailService.fetchEmails(getAccessToken(account), account.id, maxResults, pageToken);
      } else {
        return imapService.fetchEmails(
          { host: account.imapHost, port: account.imapPort, email: account.email, password: account.imapPassword },
          account.id,
          maxResults
        );
      }
    });

    const results = await Promise.allSettled(allEmailsPromises);
    const allEmails = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<any[]>).value);

    allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json(allEmails);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/emails/search
router.get('/emails/search', async (req: Request, res: Response) => {
  const query = req.query.query as string;
  const accountId = req.query.accountId as string | undefined;

  try {
    const targetAccounts = accountId
      ? [accounts.get(accountId)].filter(Boolean)
      : Array.from(accounts.values());

    const results = await Promise.allSettled(
      targetAccounts.map(async (account) => {
        if (account.provider === 'gmail') {
          return gmailService.searchEmails(getAccessToken(account), account.id, query);
        } else {
          return imapService.searchEmails(
            { host: account.imapHost, port: account.imapPort, email: account.email, password: account.imapPassword },
            account.id,
            query
          );
        }
      })
    );

    const emails = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<any[]>).value);

    res.json(emails);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/emails/send
router.post('/emails/send', async (req: Request, res: Response) => {
  const { accountId, ...payload } = req.body;
  const account = accounts.get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    if (account.provider === 'gmail') {
      await gmailService.sendEmail(getAccessToken(account), payload);
    } else {
      await imapService.sendEmail(
        { host: account.imapHost, port: account.imapPort, email: account.email, password: account.imapPassword },
        payload
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/emails/:id/archive
router.post('/emails/:id/archive', async (req: Request, res: Response) => {
  const { accountId } = req.body;
  const account = accounts.get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    if (account.provider === 'gmail') {
      await gmailService.archiveEmail(getAccessToken(account), req.params.id as string);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/emails/:id/delete
router.post('/emails/:id/delete', async (req: Request, res: Response) => {
  const { accountId } = req.body;
  const account = accounts.get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    if (account.provider === 'gmail') {
      await gmailService.deleteEmail(getAccessToken(account), req.params.id as string);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/emails/:id/read
router.post('/emails/:id/read', async (req: Request, res: Response) => {
  const { accountId } = req.body;
  const account = accounts.get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    if (account.provider === 'gmail') {
      await gmailService.markAsRead(getAccessToken(account), req.params.id as string);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/ai/summarize — streaming
router.post('/ai/summarize', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/v1/ai/draft-reply — streaming
router.post('/ai/draft-reply', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/v1/ai/prioritize
router.post('/ai/prioritize', async (req: Request, res: Response) => {
  const { subject, body, from } = req.body;
  try {
    const score = await aiService.prioritizeEmail(subject, body, from);
    res.json({ score });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
