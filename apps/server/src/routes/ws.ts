import type { FastifyInstance } from 'fastify';
import { broker } from '../services/events';
import { getAllRepos } from '../managers/repos';
import { getActiveTasks } from '../managers/tasks';
import { getLatestUsage } from '../managers/usage';
import { getAllActivePreviews } from '../managers/preview';
import { getDb } from '../db';
import type { ServerEvent, StateSnapshot, ClientEvent } from '@claudectrl/shared';

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    // Send initial state snapshot
    const snapshot: StateSnapshot = {
      repos: getAllRepos(),
      tasks: getActiveTasks(),
      sessions: getDb().prepare("SELECT * FROM sessions WHERE status = 'active'").all() as never[],
      usage: getLatestUsage(),
      previews: getAllActivePreviews(),
    };

    socket.send(JSON.stringify({ type: 'state.snapshot', data: snapshot } satisfies ServerEvent));

    // Subscribe to all events
    const onEvent = (event: ServerEvent) => {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(JSON.stringify(event));
      }
    };
    broker.on('event', onEvent);

    socket.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as ClientEvent;
        if (event.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {}
    });

    socket.on('close', () => {
      broker.off('event', onEvent);
    });

    socket.on('error', () => {
      broker.off('event', onEvent);
    });
  });
}
