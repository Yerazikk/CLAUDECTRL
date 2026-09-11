import { useState } from 'react';
import type { Repository, Task } from '@claudectrl/shared';


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
    case 'ready_for_review': return 'Review';
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
  const [isFocused, setIsFocused] = useState(false);

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
    <div style={{ maxWidth: 580, margin: '0 auto', padding: '32px 20px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--c-fg)',
          letterSpacing: -0.5,
          marginBottom: 2,
        }}>
          Projects
        </h1>
        <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>
          {repos.length} {repos.length === 1 ? 'project' : 'projects'} registered
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderRadius: 'var(--r-xl)',
          boxShadow: isFocused ? 'var(--shadow-inset-deep)' : 'var(--shadow-inset)',
          background: 'var(--c-bg)',
          transition: 'box-shadow 0.3s ease-out',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--c-subtle)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.5"/>
            <path d="M9.5 9.5L13 13"/>
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Search projects..."
            style={{
              flex: 1,
              fontSize: 14,
              color: 'var(--c-fg)',
              background: 'transparent',
              outline: 'none',
            }}
            aria-label="Search projects"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ color: 'var(--c-subtle)', fontSize: 16, lineHeight: 1, padding: 2 }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {filtered ? (
        <Section title="">
          {filtered.length === 0 && (
            <p style={{ fontSize: 14, color: 'var(--c-muted)', padding: '12px 0' }}>No projects found</p>
          )}
          {filtered.map((r) => (
            <RepoCard key={r.id} repo={r} task={activeTask(r.id) ?? readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
          ))}
        </Section>
      ) : (
        <>
          {continueRepos.length > 0 && (
            <Section title="In progress">
              {continueRepos.map((r) => (
                <RepoCard key={r.id} repo={r} task={activeTask(r.id)} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {reviewRepos.length > 0 && (
            <Section title="Ready for review">
              {reviewRepos.map((r) => (
                <RepoCard key={r.id} repo={r} task={readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {(continueRepos.length > 0 || reviewRepos.length > 0) && recentRepos.length > 0 && (
            <Section title="Recent">
              {recentRepos.slice(0, 5).map((r) => (
                <RepoCard key={r.id} repo={r} onClick={() => onSelectRepo(r.id)} />
              ))}
            </Section>
          )}

          {continueRepos.length === 0 && reviewRepos.length === 0 && (
            <Section title="All projects">
              {repos.length === 0 ? (
                <div style={{
                  padding: '32px 24px',
                  borderRadius: 'var(--r-xl)',
                  boxShadow: 'var(--shadow-raised)',
                  background: 'var(--c-bg)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 6 }}>
                    No projects yet
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 20 }}>
                    Add a GitHub repo or local folder to get started.
                  </p>
                  <button
                    onClick={onAddRepo}
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      padding: '10px 24px',
                      borderRadius: 'var(--r-full)',
                      background: 'var(--c-accent)',
                      color: '#fff',
                      boxShadow: '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)',
                      transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '6px 6px 16px rgb(163 177 198 / 0.6), -3px -3px 10px rgba(255,255,255,0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)';
                    }}
                  >
                    Add your first project
                  </button>
                </div>
              ) : (
                repos.map((r) => (
                  <RepoCard key={r.id} repo={r} task={activeTask(r.id) ?? readyTask(r.id)} onClick={() => onSelectRepo(r.id)} />
                ))
              )}
            </Section>
          )}
        </>
      )}

      {/* Add project button */}
      <div style={{ marginTop: 20 }}>
        <button
          onClick={onAddRepo}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--c-muted)',
            padding: '10px 18px',
            borderRadius: 'var(--r-full)',
            boxShadow: 'var(--shadow-raised-sm)',
            background: 'var(--c-bg)',
            transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out, color 0.2s ease-out',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-hover)';
            e.currentTarget.style.color = 'var(--c-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
            e.currentTarget.style.color = 'var(--c-muted)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'translateY(0.5px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-hover)';
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          Add project
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      {title && (
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--c-subtle)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 12,
          paddingLeft: 4,
        }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function RepoCard({ repo, task, onClick }: { repo: Repository; task?: Task; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-raised-sm)',
        background: 'var(--c-bg)',
        width: '100%',
        textAlign: 'left',
        gap: 12,
        transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-raised-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'translateY(0.5px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 2 }}>
          {repo.name}
        </div>
        {task?.title && (
          <div style={{
            fontSize: 12,
            color: 'var(--c-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {task.title.slice(0, 65)}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        {task ? (
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            color: repo.status === 'ready_for_review' ? 'var(--c-accent)' : 'var(--c-muted)',
            padding: '3px 10px',
            borderRadius: 'var(--r-full)',
            boxShadow: repo.status === 'ready_for_review' ? 'var(--shadow-raised-xs)' : undefined,
            background: 'var(--c-bg)',
          }}>
            {statusLabel(repo)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--c-subtle)' }}>
            {repo.lastActivityAt ? relativeTime(repo.lastActivityAt) : ''}
          </span>
        )}
        <span style={{ color: 'var(--c-subtle)', fontSize: 14 }}>›</span>
      </div>
    </button>
  );
}
