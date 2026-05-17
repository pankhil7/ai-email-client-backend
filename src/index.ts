import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import emailsRouter from './routes/emails.routes';
import authRouter from './routes/auth.routes';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/v1', authRouter);
app.use('/api/v1', emailsRouter);

app.listen(PORT, () => {
  console.log(`AI Email Backend running on http://localhost:${PORT}`);
});

export default app;
