import { useState, useEffect } from 'react';
import { api } from '../utils/api';

interface GithubRepo {
  owner: string;
  name: string;
  description: string;
  private: boolean;
  isCloned: boolean;
  repoId: string | null;
}

interface Props {
  onDone: (repoId?: string) => void;
}

export function AddProject({ onDone }: Props) {
  const [tab, setTab] = useState<'github' | 'local'>('github');
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [localPath, setLocalPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (tab === 'github') {
      setLoading(true);
      api.github.repos()
        .then((repos) => setGithubRepos(repos as GithubRepo[]))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab]);

  const handleClone = async (repo: GithubRepo) => {
    // If already cloned locally, just open it
    if (repo.isCloned && repo.repoId) {
      onDone(repo.repoId);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.repos.clone(repo.owner, repo.name) as { id: string };
      onDone(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clone failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterLocal = async () => {
    if (!localPath.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.repos.register(localPath.trim()) as { id: string };
      onDone(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const filtered = search
    ? githubRepos.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : githubRepos;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button onClick={() => onDone()} style={{ color: 'var(--c-muted)', fontSize: 13 }}>←</button>
        <h1 style={{ fontSize: 17, fontWeight: 600 }}>Add project</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--c-border)', marginBottom: 24 }}>
        {(['github', 'local'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 13,
              paddingBottom: 10,
              borderBottom: `2px solid ${tab === t ? 'var(--c-fg)' : 'transparent'}`,
              color: tab === t ? 'var(--c-fg)' : 'var(--c-muted)',
              fontWeight: tab === t ? 500 : 400,
              transition: 'color 0.15s',
            }}
          >
            {t === 'github' ? 'Clone from GitHub' : 'Add local'}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: '#c0392b', marginBottom: 16, padding: '8px 12px', background: '#fff5f5', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {tab === 'github' && (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repositories..."
            style={{
              width: '100%',
              fontSize: 14,
              padding: '8px 0',
              borderBottom: '1px solid var(--c-border)',
              marginBottom: 16,
            }}
          />
          {loading ? (
            <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>Loading...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {filtered.map((repo) => (
                <div
                  key={`${repo.owner}/${repo.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--c-border-light)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {repo.name}
                      {repo.private && (
                        <span style={{ fontSize: 11, color: 'var(--c-subtle)', marginLeft: 6 }}>private</span>
                      )}
                      {repo.isCloned && (
                        <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 6 }}>cloned</span>
                      )}
                    </div>
                    {repo.description && (
                      <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>
                        {repo.description.slice(0, 80)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleClone(repo)}
                    disabled={loading}
                    style={{
                      fontSize: 12,
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: '1px solid var(--c-border)',
                      color: 'var(--c-fg)',
                      background: repo.isCloned ? 'var(--c-hover)' : 'var(--c-bg)',
                      flexShrink: 0,
                      marginLeft: 12,
                    }}
                  >
                    {repo.isCloned ? 'Open' : 'Clone'}
                  </button>
                </div>
              ))}
              {filtered.length === 0 && !loading && (
                <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>No repositories found</p>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>
              Repository path
            </label>
            <input
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="C:/Users/me/GitHub/my-project"
              style={{
                width: '100%',
                fontSize: 13,
                fontFamily: 'var(--mono)',
                padding: '8px 0',
                borderBottom: '1px solid var(--c-border)',
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleRegisterLocal()}
            />
          </div>
          <button
            onClick={handleRegisterLocal}
            disabled={loading || !localPath.trim()}
            style={{
              fontSize: 14,
              padding: '10px 20px',
              background: 'var(--c-fg)',
              color: '#fff',
              borderRadius: 6,
              opacity: loading || !localPath.trim() ? 0.5 : 1,
            }}
          >
            Add project
          </button>
        </div>
      )}
    </div>
  );
}
