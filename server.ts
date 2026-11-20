import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === 'production';

  // Parse JSON payloads up to 15MB to accommodate uploaded CSV datasets
  app.use(express.json({ limit: '15mb' }));

  // Basic security headers — never expose server-private data directories
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Mount API routes
  app.use('/api', apiRouter);

  // Health check for Cloud Run compatibility
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'muleshield' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MuleShield server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MuleShield server:', err);
  process.exit(1);
});
