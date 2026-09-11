import type { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { getConfig, reloadConfig } from '../utils/config';
import { getLatestUsage } from '../managers/usage';
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

  app.post('/api/settings/reload-config', async () => {
    reloadConfig();
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
