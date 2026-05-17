import { Router, Request, Response } from 'express';
import { google } from 'googleapis';

const router = Router();

// In-memory token store (keyed by accountId)
export const tokenStore: Map<string, { accessToken: string; refreshToken: string; email: string }> = new Map();

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
    tokenStore.set(accountId, {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || '',
      email,
    });

    // Redirect back to frontend with account info
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/auth/callback?accountId=${accountId}&email=${email}&provider=gmail`
    );
  } catch (err: any) {
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

export default router;
