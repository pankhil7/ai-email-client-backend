import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import axios from 'axios';
import pool from '../db';
import logger from '../logger';

const router = Router();

// In-memory token store — seeded from PostgreSQL on startup
export const tokenStore: Map<string, { accessToken: string; refreshToken: string; email: string }> = new Map();

export async function initTokenStore(): Promise<void> {
  const { rows } = await pool.query('SELECT * FROM tokens');
  rows.forEach((row: any) => {
    tokenStore.set(row.account_id, {
      accessToken: row.access_token,
      refreshToken: row.refresh_token || '',
      email: row.email || '',
    });
  });
  logger.info('Token store seeded from DB', { count: rows.length });
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/google/callback'
  );
}

// GET /api/v1/auth/google — start OAuth flow
router.get('/auth/google', (req: Request, res: Response) => {
  const oauth2Client = getOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });

  res.redirect(url);
});

// GET /api/v1/auth/google/callback — handle OAuth callback
router.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email || '';

    const accountId = `gmail-${email}`;
    logger.info('Gmail OAuth success', { accountId, email });
    tokenStore.set(accountId, {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || '',
      email,
    });

    // Persist token to PostgreSQL
    await pool.query(
      `INSERT INTO tokens (account_id, access_token, refresh_token, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         email = EXCLUDED.email`,
      [accountId, tokens.access_token || '', tokens.refresh_token || '', email]
    );

    // Redirect back to frontend with account info
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/auth/callback?accountId=${accountId}&email=${email}&provider=gmail`
    );
  } catch (err: any) {
    logger.error('Gmail OAuth callback failed', { message: err.message, stack: err.stack });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/v1/auth/token/:accountId — get stored token (for internal use)
router.get('/auth/token/:accountId', (req: Request, res: Response) => {
  const token = tokenStore.get(req.params.accountId as string);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  res.json({ accessToken: token.accessToken });
});

// ── Microsoft / Office 365 OAuth ──────────────────────────────────────────

function getMicrosoftAuthUrl(): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/microsoft/callback';
  const scopes = [
    'openid', 'email', 'profile', 'offline_access',
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/Mail.ReadWrite',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId!,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    response_mode: 'query',
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

// GET /api/v1/auth/microsoft
router.get('/auth/microsoft', (_req: Request, res: Response) => {
  if (!process.env.MICROSOFT_CLIENT_ID) {
    return res.status(500).send('Microsoft OAuth not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to .env');
  }
  res.redirect(getMicrosoftAuthUrl());
});

// GET /api/v1/auth/microsoft/callback
router.get('/auth/microsoft/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/microsoft/callback';

    // Exchange code for tokens
    const tokenRes = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token } = tokenRes.data;

    // Get user email from MS Graph
    const userRes = await axios.get('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const email = userRes.data.mail || userRes.data.userPrincipalName || '';

    const accountId = `office365-${email}`;
    logger.info('Office365 OAuth success', { accountId, email });
    tokenStore.set(accountId, { accessToken: access_token, refreshToken: refresh_token || '', email });

    await pool.query(
      `INSERT INTO tokens (account_id, access_token, refresh_token, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         email = EXCLUDED.email`,
      [accountId, access_token, refresh_token || '', email]
    );

    res.redirect(`${frontendUrl}/auth/callback?accountId=${accountId}&email=${encodeURIComponent(email)}&provider=office365`);
  } catch (err: any) {
    logger.error('Office365 OAuth callback failed', { message: err.message, stack: err.stack });
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

export default router;
