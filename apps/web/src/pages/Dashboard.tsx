import { useState, useMemo } from 'react';
import type { Repository, Task } from '@claudectrl/shared';
import { StatusDot } from '../components/StatusDot';

interface Props {
  repos: Repository[];
  tasks: Task[];
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
}

function statusLabel(repo: Repository): string {
  if (!repo.isCloned) return 'Not cloned';
  switch (repo.status) {
    case 'working': return 'Working';
    case 'validating': return 'Validating';
    case 'ready_for_review': return 'Ready for review';
    case 'idle': return repo.lastActivityAt ? 'Idle' : '';
    default: return '';
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

export function Dashboard({ repos, tasks, onSelectRepo, onAddRepo }: Props) {
  const [search, setSearch] = useState('');

  const activeTask = (repoId: string) =>
    tasks.find((t) => t.repoId === repoId && ['working', 'validating', 'queued'].includes(t.status));

  const readyTask = (repoId: string) =>
    tasks.find((t) => t.repoId === repoId && t.status === 'ready_for_review');

  const continueRepos = repos.filter((r) => r.status === 'working' || r.status === 'validating');
  const reviewRepos = repos.filter((r) => r.status === 'ready_for_review');
  const recentRepos = repos.filter(
    (r) => r.status === 'idle' && r.lastActivityAt && !continueRepos.includes(r) && !reviewRepos.includes(r)
  );

  const filtered = search
    ? repos.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.3, marginBottom: 32 }}>
        CLAUDECTRL
      </h1>

      {/* Search */}
      <div style={{ marginBottom: 32 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Select a project"
          style={{
            width: '100%',
            fontSize: 15,
            padding: '8px 0',
            borderBottom: '1px solid var(--c-border)',
            color: search ? 'var(--c-fg)' : 'var(--c-muted)',
          }}
          aria-label="Search projects"
        />
      </div>

      {filtered ? (
        <Section title="">
          {filtered.length === 0 && (
            <p style={{ color: 'var(--c-muted)', fontSize: 14 }}>No projects found</p>
          )}
          {filtered.map((r) => (
            <RepoRow key={r.id} repo={r} task={activeTask(r.id) ?? readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
          ))}
        </Section>
      ) : (
        <>
          {continueRepos.length > 0 && (
            <Section title="Continue">
              {continueRepos.map((r) => (
                <RepoRow key={r.id} repo={r} task={activeTask(r.id)} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {reviewRepos.length > 0 && (
            <Section title="Ready for review">
              {reviewRepos.map((r) => (
                <RepoRow key={r.id} repo={r} task={readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {(continueRepos.length > 0 || reviewRepos.length > 0) && recentRepos.length > 0 && (
            <Section title="Recent">
              {recentRepos.slice(0, 5).map((r) => (
                <RepoRow key={r.id} repo={r} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {continueRepos.length === 0 && reviewRepos.length === 0 && (
            <Section title="Projects">
              {repos.length === 0 ? (
                <p style={{ color: 'var(--c-muted)', fontSize: 14 }}>
                  No projects yet.{' '}
                  <button
                    onClick={onAddRepo}
                    style={{ color: 'var(--c-fg)', textDecoration: 'underline' }}
                  >
                    Add a project
                  </button>
                </p>
              ) : (
                repos.map((r) => (
                  <RepoRow key={r.id} repo={r} task={activeTask(r.id) ?? readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
                ))
              )}
            </Section>
          )}
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          onClick={onAddRepo}
          style={{
            fontSize: 13,
            color: 'var(--c-muted)',
            padding: '6px 0',
            borderBottom: '1px solid transparent',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted)')}
        >
          + Add project
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {children}
      </div>
    </div>
  );
}

function RepoRow({ repo, task, onClick }: { repo: Repository; task?: Task; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--c-border-light)',
        width: '100%',
        textAlign: 'left',
        gap: 12,
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <StatusDot status={repo.status} size={5} pulse />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{repo.name}</span>
        </div>
        {task?.title && (
          <span style={{ fontSize: 12, color: 'var(--c-muted)', paddingLeft: 12 }}>
            {task.title.slice(0, 60)}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-subtle)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {task ? statusLabel(repo) : (repo.lastActivityAt ? relativeTime(repo.lastActivityAt) : '')}
      </div>
    </button>
  );
}
