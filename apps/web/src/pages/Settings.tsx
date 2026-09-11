import { useState, useEffect } from 'react';
import { api } from '../utils/api';

interface HealthCheck {
  status: string;
  checks: {
    claudeCli: boolean;
    git: boolean;
    gh: boolean;
    vercel: boolean | null;
  };
}

interface Props {
  onBack: () => void;
}

export function Settings({ onBack }: Props) {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);

  useEffect(() => {
    api.settings.health()
      .then((h) => setHealth(h as HealthCheck))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleShutdown = async () => {
    if (!shutdownConfirm) { setShutdownConfirm(true); return; }
    await api.server.shutdown().catch(() => {});
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button onClick={onBack} style={{ color: 'var(--c-muted)', fontSize: 13 }}>←</button>
        <h1 style={{ fontSize: 17, fontWeight: 600 }}>Settings</h1>
      </div>

      <section style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
          System health
        </div>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>Checking...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <HealthRow label="Claude CLI" ok={health?.checks.claudeCli ?? false} />
            <HealthRow label="Git" ok={health?.checks.git ?? false} />
            <HealthRow label="GitHub CLI" ok={health?.checks.gh ?? false} />
            {health?.checks.vercel !== null && (
              <HealthRow label="Vercel CLI" ok={health?.checks.vercel ?? false} />
            )}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
          Remote access
        </div>
        <p style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.6 }}>
          For phone access, install <strong>Tailscale</strong> on both this PC and your phone.
          Connect to this machine's Tailscale IP at port 4173.
        </p>
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
          Server
        </div>
        <button
          onClick={handleShutdown}
          style={{
            fontSize: 13,
            color: shutdownConfirm ? '#c0392b' : 'var(--c-muted)',
            padding: '6px 0',
          }}
        >
          {shutdownConfirm ? 'Click again to shut down' : 'Shut down ClaudeCTRL'}
        </button>
        {shutdownConfirm && (
          <button
            onClick={() => setShutdownConfirm(false)}
            style={{ fontSize: 12, color: 'var(--c-subtle)', marginLeft: 12 }}
          >
            Cancel
          </button>
        )}
      </section>
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <span>{label}</span>
      <span style={{ color: ok ? '#22c55e' : '#c0392b', fontSize: 12 }}>
        {ok ? '✓' : '✗'}
      </span>
    </div>
  );
}
