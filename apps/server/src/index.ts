import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { initDb } from './db';
import { loadConfig } from './utils/config';
import { initLogger, logger } from './utils/logger';
import { reposRoutes } from './routes/repos';
import { settingsRoutes } from './routes/settings';
import { wsRoutes } from './routes/ws';
import { startUsageScheduler, stopUsageScheduler } from './managers/usage';
import { scanReposDirectory } from './managers/repos';
import { ensureGeneralWorkspace } from './managers/general';
import { getAllActivePreviews } from './managers/preview';
import { recoverInterruptedTasks } from './managers/tasks';

async function start(): Promise<void> {
  const cfg = loadConfig();
  const dataDir = path.isAbsolute(cfg.data_dir)
    ? cfg.data_dir
    : path.resolve(process.cwd(), cfg.data_dir);

  initLogger(dataDir);
  initDb(dataDir);
  logger.info('ClaudeCTRL starting up...');
  recoverInterruptedTasks();

  // Initialize General workspace and scan repos directory on startup
  try { ensureGeneralWorkspace(); } catch (e) { logger.warn('General workspace init failed', e); }
  if (cfg.repos.directory) {
    try { scanReposDirectory(); } catch (e) { logger.warn('Repo scan failed', e); }
  }

  const app = Fastify({ logger: false });

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyWebsocket);

  // Register API routes
  await app.register(reposRoutes);
  await app.register(settingsRoutes);
  await app.register(wsRoutes);

  // Preview proxy routes - proxy /preview/:repoId/* to the local dev server
  app.all<{ Params: { repoId: string; '*': string } }>('/preview/:repoId/*', async (req, reply) => {
    const previews = getAllActivePreviews();
    const preview = previews.find((p) => p.repoId === req.params.repoId);
    if (!preview) {
      return reply.status(404).send('No active preview for this repo');
    }

    const targetUrl = new URL(preview.localUrl);
    const wildcard = req.params['*'] ?? '';
    const proxyPath = '/' + wildcard + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

    return new Promise<void>((resolve) => {
      const proxyReq = http.request(
        {
          hostname: targetUrl.hostname,
          port: parseInt(targetUrl.port || '80', 10),
          path: proxyPath || '/',
          method: req.method,
          headers: { ...req.headers, host: targetUrl.host },
        },
        (proxyRes) => {
          reply.status(proxyRes.statusCode ?? 200);
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v) reply.header(k, v as string);
          }
          proxyRes.pipe(reply.raw);
          proxyRes.on('end', resolve);
        }
      );
      proxyReq.on('error', () => {
        reply.status(502).send('Preview server unavailable');
        resolve();
      });
      if (req.body) proxyReq.write(JSON.stringify(req.body));
      proxyReq.end();
    });
  });

  // Serve web client in production
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: false,
    });

    app.setNotFoundHandler(async (req, reply) => {
      if (!req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/preview')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  startUsageScheduler();

  const host = cfg.server.host;
  const port = cfg.server.port;
  await app.listen({ host, port });
  logger.info(`ClaudeCTRL server running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

  // Handle WebSocket upgrades for preview proxy (HMR passthrough)
  app.server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const match = url.match(/^\/preview\/([^/]+)\//);
    if (!match) return;

    const repoId = match[1];
    const previews = getAllActivePreviews();
    const preview = previews.find((p) => p.repoId === repoId);
    if (!preview) { (socket as net.Socket).destroy(); return; }

    const targetUrl = new URL(preview.localUrl);
    const targetPort = parseInt(targetUrl.port || '80', 10);
    const proxyPath = url.replace(`/preview/${repoId}`, '') || '/';

    const proxySocket = net.connect(targetPort, targetUrl.hostname, () => {
      // Forward the upgrade request
      const reqHead = [
        `${req.method ?? 'GET'} ${proxyPath} HTTP/1.1`,
        `Host: ${targetUrl.host}`,
        `Upgrade: ${req.headers.upgrade ?? 'websocket'}`,
        `Connection: Upgrade`,
        ...Object.entries(req.headers)
          .filter(([k]) => !['host', 'upgrade', 'connection'].includes(k.toLowerCase()))
          .map(([k, v]) => `${k}: ${v}`),
        '',
        '',
      ].join('\r\n');

      proxySocket.write(reqHead);
      if (head.length) proxySocket.write(head);
      proxySocket.pipe(socket as net.Socket);
      (socket as net.Socket).pipe(proxySocket);
    });
    proxySocket.on('error', () => { try { (socket as net.Socket).destroy(); } catch {} });
    (socket as net.Socket).on('error', () => { try { proxySocket.destroy(); } catch {} });
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    stopUsageScheduler();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
