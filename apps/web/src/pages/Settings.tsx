import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import type { UsageSnapshot } from '@claudectrl/shared';

interface HealthCheck {
  status: string;
  checks: {
    claudeCli: boolean;
    git: boolean;
    gh: boolean;
    vercel: boolean | null;
  };
  usage: UsageSnapshot | null;
}

interface Props {
  onBack: () => void;
}

export function Settings({ onBack }: Props) {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);
  const [usageRefreshing, setUsageRefreshing] = useState(false);

  const [promptContent, setPromptContent] = useState('');
  const [promptPath, setPromptPath] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);

  useEffect(() => {
    api.settings.health()
      .then((h) => setHealth(h as HealthCheck))
      .catch(() => {})
      .finally(() => setLoading(false));

    api.settings.getPrompt()
      .then((r) => { setPromptContent(r.content); setPromptPath(r.path); })
      .catch(() => {});
  }, []);

  const handlePromptSave = async () => {
    setPromptSaving(true);
    try {
      await api.settings.savePrompt(promptContent);
      setPromptSaved(true);
      setPromptDirty(false);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch {}
    setPromptSaving(false);
  };

  const handleShutdown = async () => {
    if (!shutdownConfirm) { setShutdownConfirm(true); return; }
    await api.server.shutdown().catch(() => {});
  };

  const handleRefreshUsage = async () => {
    setUsageRefreshing(true);
    try {
      const snapshot = await api.settings.refreshUsage() as UsageSnapshot;
      setHealth((h) => h ? { ...h, usage: snapshot } : h);
    } catch {}
    setUsageRefreshing(false);
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 48px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button
          onClick={onBack}
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
          onMouseDown={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
          }}
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
          Settings
        </h1>
      </div>

      {/* System health */}
      <SectionLabel>System health</SectionLabel>
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-raised)',
        background: 'var(--c-bg)',
        padding: '4px 0',
        marginBottom: 24,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--c-muted)' }}>
            Checking system...
          </div>
        ) : (
          <>
            <HealthRow label="Claude CLI" ok={health?.checks.claudeCli ?? false} />
            <HealthRow label="Git" ok={health?.checks.git ?? false} />
            <HealthRow label="GitHub CLI" ok={health?.checks.gh ?? false} />
            {health?.checks.vercel !== null && (
              <HealthRow label="Vercel CLI" ok={health?.checks.vercel ?? false} last />
            )}
          </>
        )}
      </div>

      {/* Claude Usage */}
      <SectionLabel>Claude usage</SectionLabel>
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-raised)',
        background: 'var(--c-bg)',
        padding: '20px 24px',
        marginBottom: 24,
      }}>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>Checking usage...</p>
        ) : health?.usage ? (
          <>
            <pre style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--c-fg)',
              background: 'var(--c-bg)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-inset)',
              padding: '12px 14px',
              margin: '0 0 12px',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {health.usage.raw || 'No output captured'}
            </pre>
            <p style={{ fontSize: 11, color: 'var(--c-subtle)', margin: '0 0 12px', fontFamily: 'var(--mono)' }}>
              Last updated: {new Date(health.usage.capturedAt).toLocaleString()}
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 12 }}>
            No usage data yet — refreshes every 5 min or after each task.
          </p>
        )}
        <button
          onClick={handleRefreshUsage}
          disabled={usageRefreshing}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 20px',
            borderRadius: 'var(--r-full)',
            background: 'var(--c-bg)',
            color: 'var(--c-accent)',
            boxShadow: usageRefreshing ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-sm)',
            transition: 'box-shadow 0.3s ease-out',
            opacity: usageRefreshing ? 0.6 : 1,
            cursor: usageRefreshing ? 'default' : 'pointer',
          }}
        >
          {usageRefreshing ? 'Fetching...' : 'Refresh usage'}
        </button>
      </div>

      {/* System Prompt */}
      <SectionLabel>System prompt</SectionLabel>
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-raised)',
        background: 'var(--c-bg)',
        padding: '20px 24px',
        marginBottom: 24,
      }}>
        <p style={{ fontSize: 12, color: 'var(--c-subtle)', marginBottom: 12, fontFamily: 'var(--mono)' }}>
          {promptPath || 'prompts/task.md'}
        </p>
        <textarea
          value={promptContent}
          onChange={(e) => { setPromptContent(e.target.value); setPromptDirty(true); setPromptSaved(false); }}
          rows={14}
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            lineHeight: 1.6,
            padding: '12px 14px',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-inset)',
            background: 'var(--c-bg)',
            color: 'var(--c-fg)',
            resize: 'vertical',
            border: 'none',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button
            onClick={handlePromptSave}
            disabled={!promptDirty || promptSaving}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 'var(--r-full)',
              background: 'var(--c-bg)',
              color: promptSaved ? 'var(--c-success)' : promptDirty ? 'var(--c-accent)' : 'var(--c-subtle)',
              boxShadow: promptDirty ? 'var(--shadow-raised-sm)' : 'var(--shadow-inset-sm)',
              transition: 'box-shadow 0.3s ease-out, color 0.2s',
              opacity: promptSaving ? 0.6 : 1,
              cursor: promptDirty ? 'pointer' : 'default',
            }}
          >
            {promptSaving ? 'Saving…' : promptSaved ? 'Saved ✓' : 'Save prompt'}
          </button>
        </div>
      </div>

      {/* Remote access */}
      <SectionLabel>Remote access</SectionLabel>
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-raised)',
        background: 'var(--c-bg)',
        padding: '20px 24px',
        marginBottom: 24,
      }}>
        <p style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.7 }}>
          For phone access, install <strong style={{ color: 'var(--c-fg)', fontWeight: 600 }}>Tailscale</strong> on
          both this PC and your phone. Connect to this machine's Tailscale IP at{' '}
          <code style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: 'var(--c-accent)',
            padding: '2px 6px',
            borderRadius: 'var(--r-xs)',
            boxShadow: 'var(--shadow-inset-sm)',
            background: 'var(--c-bg)',
          }}>
            :4173
          </code>
        </p>
      </div>

      {/* Server control */}
      <SectionLabel>Server</SectionLabel>
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-raised)',
        background: 'var(--c-bg)',
        padding: '20px 24px',
      }}>
        <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          Shut down the ClaudeCTRL server running on this machine.
          The web UI will become unavailable.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleShutdown}
            style={{
              fontSize: 14,
              fontWeight: 600,
              padding: '10px 22px',
              borderRadius: 'var(--r-full)',
              background: shutdownConfirm ? 'var(--c-failed)' : 'var(--c-bg)',
              color: shutdownConfirm ? '#fff' : 'var(--c-failed)',
              boxShadow: shutdownConfirm
                ? '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'
                : 'var(--shadow-raised-sm)',
              transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out, background 0.3s, color 0.3s',
              border: shutdownConfirm ? 'none' : '1.5px solid rgba(224,82,82,0.35)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = 'var(--shadow-raised-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = shutdownConfirm
                ? '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'
                : 'var(--shadow-raised-sm)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(1px)';
              e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = '';
            }}
          >
            {shutdownConfirm ? '⚠ Confirm shutdown' : 'Shut down ClaudeCTRL'}
          </button>

          {shutdownConfirm && (
            <button
              onClick={() => setShutdownConfirm(false)}
              style={{
                fontSize: 13,
                color: 'var(--c-muted)',
                padding: '9px 16px',
                borderRadius: 'var(--r-full)',
                boxShadow: 'var(--shadow-raised-xs)',
                background: 'var(--c-bg)',
                transition: 'box-shadow 0.3s ease-out, color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--c-fg)';
                e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--c-muted)';
                e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--c-subtle)',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 10,
      paddingLeft: 4,
    }}>
      {children}
    </div>
  );
}

function HealthRow({ label, ok, last }: { label: string; ok: boolean; last?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 24px',
      borderBottom: last ? 'none' : '1px solid rgba(163,177,198,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-fg)' }}>{label}</span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: ok ? 'var(--c-success)' : 'var(--c-failed)' }}>
        {ok ? '✓' : '✗'}
      </span>
    </div>
  );
}
