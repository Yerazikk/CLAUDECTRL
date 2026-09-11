import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { MicToggleButton } from '../components/MicToggleButton';

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
  const [searchFocused, setSearchFocused] = useState(false);
  const [pathFocused, setPathFocused] = useState(false);

  const { isListening: searchListening, toggle: toggleSearchListening, hasSupport: hasSpeechSupport } = useSpeechToText((finalizedText) => {
    setSearch((prev) => {
      const trimmedPrev = prev.replace(/\s+$/, '');
      return trimmedPrev ? `${trimmedPrev} ${finalizedText}` : finalizedText;
    });
  });
  const { isListening: pathListening, toggle: togglePathListening } = useSpeechToText((finalizedText) => {
    setLocalPath((prev) => {
      const trimmedPrev = prev.replace(/\s+$/, '');
      return trimmedPrev ? `${trimmedPrev} ${finalizedText}` : finalizedText;
    });
  });

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
    if (repo.isCloned && repo.repoId) { onDone(repo.repoId); return; }
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
    <div style={{ maxWidth: 540, margin: '0 auto', padding: '32px 20px 48px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button
          onClick={() => onDone()}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            boxShadow: 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
            color: 'var(--c-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
            transition: 'box-shadow 0.3s ease-out, color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
            e.currentTarget.style.color = 'var(--c-fg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
            e.currentTarget.style.color = 'var(--c-muted)';
          }}
          onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; }}
          onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; }}
          aria-label="Back"
        >
          ←
        </button>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 800,
          color: 'var(--c-fg)',
          letterSpacing: -0.4,
        }}>
          Add project
        </h1>
      </div>

      {/* Tab switcher */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: 5,
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-inset)',
        background: 'var(--c-bg)',
        marginBottom: 24,
      }}>
        {(['github', 'local'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              padding: '9px 16px',
              borderRadius: 'calc(var(--r-xl) - 4px)',
              color: tab === t ? 'var(--c-accent)' : 'var(--c-muted)',
              boxShadow: tab === t ? 'var(--shadow-raised-sm)' : 'none',
              background: 'var(--c-bg)',
              transition: 'box-shadow 0.3s ease-out, color 0.2s, font-weight 0.1s',
            }}
          >
            {t === 'github' ? '⎇  Clone from GitHub' : '📁  Add local path'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: 16,
          padding: '12px 16px',
          borderRadius: 'var(--r-lg)',
          boxShadow: `inset 4px 4px 8px rgb(163 177 198 / 0.4), inset -4px -4px 8px rgba(255,255,255,0.4), inset 0 0 0 1px rgba(224,82,82,0.3)`,
          background: 'var(--c-bg)',
          color: 'var(--c-failed)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* GitHub tab */}
      {tab === 'github' && (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 'var(--r-xl)',
            boxShadow: searchFocused ? 'var(--shadow-inset-deep)' : 'var(--shadow-inset)',
            background: 'var(--c-bg)',
            transition: 'box-shadow 0.3s ease-out',
            marginBottom: 16,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--c-subtle)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4.5"/>
              <path d="M9.5 9.5L13 13"/>
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={searchListening ? 'Listening...' : 'Search repositories...'}
              style={{ flex: 1, fontSize: 14, color: 'var(--c-fg)', background: 'transparent' }}
            />
            {hasSpeechSupport && (
              <MicToggleButton isListening={searchListening} onToggle={toggleSearchListening} size={26} />
            )}
          </div>

          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--c-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 10, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>↻</div>
              <div>Loading repositories...</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--c-muted)', padding: '16px 0' }}>No repositories found</p>
              )}
              {filtered.map((repo) => (
                <div
                  key={`${repo.owner}/${repo.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: 'var(--r-lg)',
                    boxShadow: 'var(--shadow-raised-sm)',
                    background: 'var(--c-bg)',
                    gap: 12,
                    transition: 'transform 0.2s ease-out, box-shadow 0.2s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-raised)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.transform = '';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-raised-sm)';
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-fg)' }}>{repo.name}</span>
                      {repo.private && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: 'var(--c-subtle)',
                          padding: '2px 7px',
                          borderRadius: 'var(--r-full)',
                          boxShadow: 'var(--shadow-inset-sm)',
                          background: 'var(--c-bg)',
                        }}>
                          private
                        </span>
                      )}
                      {repo.isCloned && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: 'var(--c-success)',
                          padding: '2px 7px',
                          borderRadius: 'var(--r-full)',
                          boxShadow: 'var(--shadow-inset-sm)',
                          background: 'var(--c-bg)',
                        }}>
                          ✓ cloned
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <div style={{
                        fontSize: 12,
                        color: 'var(--c-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {repo.description.slice(0, 80)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleClone(repo)}
                    disabled={loading}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '7px 16px',
                      borderRadius: 'var(--r-full)',
                      background: repo.isCloned ? 'var(--c-bg)' : 'var(--c-accent)',
                      color: repo.isCloned ? 'var(--c-accent)' : '#fff',
                      boxShadow: repo.isCloned
                        ? 'var(--shadow-raised-xs)'
                        : '3px 3px 8px rgb(163 177 198 / 0.5), -2px -2px 6px rgba(255,255,255,0.4)',
                      flexShrink: 0,
                      opacity: loading ? 0.6 : 1,
                      transition: 'transform 0.2s ease-out, box-shadow 0.2s ease-out',
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = repo.isCloned
                        ? 'var(--shadow-raised-xs)'
                        : '3px 3px 8px rgb(163 177 198 / 0.5), -2px -2px 6px rgba(255,255,255,0.4)';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'translateY(1px)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = '';
                    }}
                  >
                    {repo.isCloned ? 'Open' : 'Clone'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Local path tab */}
      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: '20px 24px',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-raised)',
            background: 'var(--c-bg)',
          }}>
            <label style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--c-subtle)',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              display: 'block',
              marginBottom: 12,
            }}>
              Repository path
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 'var(--r-md)',
              boxShadow: pathFocused ? 'var(--shadow-inset-deep)' : 'var(--shadow-inset)',
              background: 'var(--c-bg)',
              transition: 'box-shadow 0.3s ease-out',
              marginBottom: 20,
            }}>
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                onFocus={() => setPathFocused(true)}
                onBlur={() => setPathFocused(false)}
                placeholder={pathListening ? 'Listening...' : 'C:/Users/me/GitHub/my-project'}
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                  color: 'var(--c-fg)',
                  background: 'transparent',
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleRegisterLocal()}
              />
              {hasSpeechSupport && (
                <MicToggleButton isListening={pathListening} onToggle={togglePathListening} size={26} />
              )}
            </div>

            <button
              onClick={handleRegisterLocal}
              disabled={loading || !localPath.trim()}
              style={{
                width: '100%',
                fontSize: 14,
                fontWeight: 600,
                padding: '12px 24px',
                borderRadius: 'var(--r-full)',
                background: localPath.trim() && !loading ? 'var(--c-accent)' : 'var(--c-bg)',
                color: localPath.trim() && !loading ? '#fff' : 'var(--c-subtle)',
                boxShadow: localPath.trim() && !loading
                  ? '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'
                  : 'var(--shadow-raised-sm)',
                opacity: loading ? 0.7 : 1,
                transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out, background 0.3s, color 0.3s',
                cursor: localPath.trim() && !loading ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => {
                if (localPath.trim() && !loading) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-raised-hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = localPath.trim() && !loading
                  ? '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'
                  : 'var(--shadow-raised-sm)';
              }}
              onMouseDown={(e) => {
                if (localPath.trim() && !loading) {
                  e.currentTarget.style.transform = 'translateY(1px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
                }
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = '';
              }}
            >
              {loading ? 'Adding...' : 'Add project'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
