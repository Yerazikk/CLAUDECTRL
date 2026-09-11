import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { getConfig, reloadConfig } from '../utils/config';
import { getLatestUsage, refreshUsage } from '../managers/usage';
import type { AppSettings } from '@claudectrl/shared';

function checkCli(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const cfg = getConfig();
    const settings: AppSettings = {
      reposDirectory: cfg.repos.directory,
      serverHost: cfg.server.host,
      serverPort: cfg.server.port,
      voiceEnabled: cfg.voice.enabled,
      notificationsEnabled: cfg.notifications.enabled,
      vercelEnabled: cfg.vercel.enabled,
    };
    return settings;
  });

  app.get('/api/health', async () => {
    const cfg = getConfig();
    return {
      status: 'ok',
      checks: {
        claudeCli: checkCli('claude --version'),
        git: checkCli('git --version'),
        gh: checkCli('gh auth status'),
        vercel: cfg.vercel.enabled ? checkCli('vercel --version') : null,
      },
      usage: getLatestUsage(),
    };
  });

  app.post('/api/usage/refresh', async () => {
    const snapshot = await refreshUsage();
    return snapshot ?? { error: 'No usage data available' };
  });

  app.post('/api/settings/reload-config', async () => {
    reloadConfig();
    return { ok: true };
  });

  app.get('/api/settings/prompt', async (_req, reply) => {
    const cfg = getConfig();
    const promptPath = path.isAbsolute(cfg.prompts.task_wrapper)
      ? cfg.prompts.task_wrapper
      : path.resolve(process.cwd(), cfg.prompts.task_wrapper);
    if (!fs.existsSync(promptPath)) {
      return reply.code(404).send({ error: 'Prompt file not found' });
    }
    return { content: fs.readFileSync(promptPath, 'utf8'), path: promptPath };
  });

  app.post('/api/settings/prompt', async (req, reply) => {
    const { content } = req.body as { content: string };
    if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' });
    }
    const cfg = getConfig();
    const promptPath = path.isAbsolute(cfg.prompts.task_wrapper)
      ? cfg.prompts.task_wrapper
      : path.resolve(process.cwd(), cfg.prompts.task_wrapper);
    fs.writeFileSync(promptPath, content, 'utf8');
    return { ok: true };
  });

  // Shutdown endpoint
  app.post('/api/server/shutdown', async (req, reply) => {
    reply.send({ ok: true });
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
}
