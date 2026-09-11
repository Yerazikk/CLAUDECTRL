const BASE = (() => {
  const { hostname, port } = window.location;
  const serverPort = port === '5173' ? '4173' : port;
  return `http://${hostname}:${serverPort}`;
})();

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => req<T>('GET', path),
  post: <T>(path: string, body?: unknown) => req<T>('POST', path, body),
  delete: <T>(path: string) => req<T>('DELETE', path),

  repos: {
    list: () => api.get('/api/repos'),
    get: (id: string) => api.get(`/api/repos/${id}`),
    tasks: (id: string) => api.get(`/api/repos/${id}/tasks`),
    sessions: (id: string) => api.get(`/api/repos/${id}/sessions`),
    messages: (id: string, taskId: string) => api.get(`/api/repos/${id}/tasks/${taskId}/messages`),
    register: (path: string) => api.post('/api/repos/register', { path }),
    clone: (owner: string, repo: string) => api.post('/api/repos/clone', { owner, repo }),
    remove: (id: string) => api.delete(`/api/repos/${id}`),
    fetch: (id: string) => api.post(`/api/repos/${id}/fetch`),
    submitTask: (id: string, message: string, sessionRef?: string) =>
      api.post(`/api/repos/${id}/tasks`, { message, sessionRef }),
    feedback: (id: string, taskId: string, message: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/feedback`, { message }),
    stopTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/stop`),
    pauseTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/pause`),
    resumeTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/resume`),
    archiveTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/archive`),
    unarchiveTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/unarchive`),
    approveTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/approve`),
    deleteTask: (id: string, taskId: string) =>
      api.delete(`/api/repos/${id}/tasks/${taskId}`),
    retryTask: (id: string, taskId: string) =>
      api.post(`/api/repos/${id}/tasks/${taskId}/retry`),
  },

  github: {
    repos: () => api.get('/api/github/repos'),
  },

  settings: {
    get: () => api.get('/api/settings'),
    health: () => api.get('/api/health'),
    getPrompt: () => api.get<{ content: string; path: string }>('/api/settings/prompt'),
    savePrompt: (content: string) => api.post('/api/settings/prompt', { content }),
    refreshUsage: () => api.post('/api/usage/refresh'),
  },

  server: {
    shutdown: () => api.post('/api/server/shutdown'),
  },
};
