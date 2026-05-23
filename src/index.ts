import * as dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDb } from './db';
import emailsRouter, { initAccounts } from './routes/emails.routes';
import authRouter, { initTokenStore } from './routes/auth.routes';
import { authenticate } from './middleware/auth.middleware';
import logger from './logger';

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    logger.warn('CORS blocked request', { origin });
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// HTTP request logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ...(req.query.accountId && { accountId: req.query.accountId }),
    });
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes — no auth needed
app.use('/api/v1', authRouter);

// Protected routes — require valid JWT
app.use('/api/v1', authenticate, emailsRouter);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  try {
    await initDb();
    await initTokenStore();
    await initAccounts();
    app.listen(PORT, () => {
      logger.info(`AI Email Backend running`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        frontendUrl: process.env.FRONTEND_URL || 'NOT SET',
        databaseUrl: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      });
    });
  } catch (err: any) {
    logger.error('Failed to start server', { message: err.message, stack: err.stack });
    process.exit(1);
  }
}

main();

export default app;
