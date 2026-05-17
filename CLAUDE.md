# CLAUDE.md — AI Email Client Backend

## Project
Node.js + Express + TypeScript API server for the AI Email Client.
Handles Gmail API, IMAP connections, and Claude AI integrations.

## Stack
- **Runtime**: Node.js + TypeScript
- **Framework**: Express 5
- **Email**: googleapis (Gmail), imapflow + nodemailer (IMAP/SMTP)
- **AI**: @anthropic-ai/sdk (Claude claude-sonnet-4-6)
- **Auth**: JWT (future: OAuth flow)

## Structure
```
src/
├── index.ts              # Express app entry point
├── routes/
│   └── emails.routes.ts  # All API routes
├── services/
│   ├── gmail.service.ts  # Gmail API wrapper
│   ├── imap.service.ts   # IMAP/SMTP wrapper
│   └── ai.service.ts     # Claude API (summaries, drafts, priority)
├── middleware/           # Auth, error handling
└── types/
    └── email.types.ts    # Shared TypeScript types
```

## Agents
| Agent | Role |
|-------|------|
| API Agent | Express routes, Gmail API, IMAP integration |
| AI Agent | Claude API integration, streaming SSE responses |
| Test Agent | Jest/Supertest integration tests |

## Dev Commands
```bash
npm run dev    # nodemon + ts-node (port 4000)
npm run build  # tsc compile to /dist
npm run start  # node dist/index.js
```

## API Routes
```
GET  /health
GET  /api/v1/accounts
POST /api/v1/accounts
DEL  /api/v1/accounts/:id
GET  /api/v1/emails
GET  /api/v1/emails/search
POST /api/v1/emails/send
POST /api/v1/emails/:id/archive
POST /api/v1/emails/:id/delete
POST /api/v1/emails/:id/read
POST /api/v1/ai/summarize      (SSE streaming)
POST /api/v1/ai/draft-reply    (SSE streaming)
POST /api/v1/ai/prioritize
```

## Conventions
- All services are classes in `src/services/`
- AI calls always use `claude-sonnet-4-6` model
- Streaming endpoints use Server-Sent Events (SSE)
- Never log sensitive data (passwords, tokens)

## Environment
Copy `.env.example` to `.env` and fill values.
