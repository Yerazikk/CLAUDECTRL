import type { FastifyInstance } from 'fastify';
import {
  getAllRepos,
  getRepo,
  registerLocalRepo,
  cloneRepo,
  listGithubRepos,
  removeRepo,
  scanReposDirectory,
  fetchRepo,
  annotateWithCloneStatus,
} from '../managers/repos';
import {
  getRepoTasks,
  getRepoSessions,
  createTask,
  stopTask,
  pauseTask,
  resumeTask,
  archiveTask,
  unarchiveTask,
  approveTask,
  submitFeedback,
  getTask,
  deleteTask,
  retryTask,
} from '../managers/tasks';
import { getDb } from '../db';
import { getActivePreviewForRepo } from '../managers/preview';
import { refreshUsage } from '../managers/usage';

export async function reposRoutes(app: FastifyInstance): Promise<void> {
  // List repositories
  app.get('/api/repos', async () => {
    return getAllRepos();
  });

  // Get single repo
  app.get<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    const repo = getRepo(req.params.id);
    if (!repo) return reply.status(404).send({ error: 'Not found' });
    return repo;
  });

  // Get repo tasks
  app.get<{ Params: { id: string } }>('/api/repos/:id/tasks', async (req, reply) => {
    const repo = getRepo(req.params.id);
    if (!repo) return reply.status(404).send({ error: 'Not found' });
    return getRepoTasks(req.params.id);
  });

  // Get repo sessions
  app.get<{ Params: { id: string } }>('/api/repos/:id/sessions', async (req, reply) => {
    const repo = getRepo(req.params.id);
    if (!repo) return reply.status(404).send({ error: 'Not found' });
    return getRepoSessions(req.params.id);
  });

  // Get repo messages for a task
  app.get<{ Params: { id: string; taskId: string } }>('/api/repos/:id/tasks/:taskId/messages', async (req, reply) => {
    const db = getDb();
    return db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').all(req.params.taskId);
  });

  // Get task preview
  app.get<{ Params: { id: string } }>('/api/repos/:id/preview', async (req) => {
    return getActivePreviewForRepo(req.params.id);
  });

  // Submit task command (optionally within an existing session)
  app.post<{ Params: { id: string }; Body: { message: string; sessionRef?: string } }>(
    '/api/repos/:id/tasks',
    async (req, reply) => {
      const { message, sessionRef } = req.body;
      if (!message?.trim()) return reply.status(400).send({ error: 'message required' });
      const repo = getRepo(req.params.id);
      if (!repo) return reply.status(404).send({ error: 'Not found' });
      const task = await createTask(req.params.id, message.trim(), sessionRef);
      return task;
    }
  );

  // Submit feedback on a task
  app.post<{ Params: { id: string; taskId: string }; Body: { message: string } }>(
    '/api/repos/:id/tasks/:taskId/feedback',
    async (req, reply) => {
      const { message } = req.body;
      if (!message?.trim()) return reply.status(400).send({ error: 'message required' });
      const task = getTask(req.params.taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      await submitFeedback(req.params.taskId, message.trim());
      return { ok: true };
    }
  );

  // Stop a task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/stop',
    async (req, reply) => {
      await stopTask(req.params.taskId);
      return { ok: true };
    }
  );

  // Pause a task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/pause',
    async (req, reply) => {
      await pauseTask(req.params.taskId);
      return { ok: true };
    }
  );

  // Resume a paused/stopped task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/resume',
    async (req, reply) => {
      try {
        await resumeTask(req.params.taskId);
        return { ok: true };
      } catch (e: unknown) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // Archive a task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/archive',
    async (req, reply) => {
      await archiveTask(req.params.taskId);
      return { ok: true };
    }
  );

  // Unarchive a task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/unarchive',
    async (req, reply) => {
      await unarchiveTask(req.params.taskId);
      return { ok: true };
    }
  );

  // Approve a task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/approve',
    async (req, reply) => {
      const task = getTask(req.params.taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      approveTask(req.params.taskId).catch(() => {}); // runs in background
      return { ok: true };
    }
  );

  // Delete a task (failed/stopped/done only)
  app.delete<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId',
    async (req, reply) => {
      try {
        await deleteTask(req.params.taskId);
        return { ok: true };
      } catch (e: unknown) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // Retry a failed/stopped task
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/repos/:id/tasks/:taskId/retry',
    async (req, reply) => {
      try {
        const task = await retryTask(req.params.taskId);
        return task;
      } catch (e: unknown) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // Register local repo
  app.post<{ Body: { path: string } }>('/api/repos/register', async (req, reply) => {
    try {
      const repo = registerLocalRepo(req.body.path);
      return repo;
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Clone from GitHub
  app.post<{ Body: { owner: string; repo: string } }>('/api/repos/clone', async (req, reply) => {
    try {
      const repo = await cloneRepo(req.body.owner, req.body.repo);
      return repo;
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Remove repo from ClaudeCTRL (NOT filesystem deletion)
  app.delete<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    try {
      removeRepo(req.params.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // List GitHub repos (annotated with local clone status)
  app.get('/api/github/repos', async () => {
    const repos = await listGithubRepos();
    return annotateWithCloneStatus(repos);
  });

  // Fetch latest from remote (called on project open)
  app.post<{ Params: { id: string } }>('/api/repos/:id/fetch', async (req, reply) => {
    const repo = getRepo(req.params.id);
    if (!repo) return reply.status(404).send({ error: 'Not found' });
    fetchRepo(req.params.id);  // fire and forget — non-blocking
    return { ok: true };
  });
}
