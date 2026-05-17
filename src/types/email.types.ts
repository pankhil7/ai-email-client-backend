export type EmailProvider = 'gmail' | 'office365' | 'imap';

export interface EmailAccount {
  id: string;
  email: string;
  provider: EmailProvider;
  accessToken?: string;
  refreshToken?: string;
  imapHost?: string;
  imapPort?: number;
  imapPassword?: string;
  color: string;
}

export interface Email {
  id: string;
  accountId: string;
  provider: EmailProvider;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc?: { name: string; email: string }[];
  subject: string;
  body: string;
  bodyText: string;
  date: string;
  read: boolean;
  starred: boolean;
  labels: string[];
  hasAttachments: boolean;
  threadId?: string;
  aiPriority?: number;
  aiSummary?: string;
}

export interface ComposePayload {
  accountId: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  replyToId?: string;
  forwardFromId?: string;
}

export interface SearchQuery {
  accountId?: string;
  query: string;
  folder?: string;
}
