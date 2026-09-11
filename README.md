# ClaudeCTRL

A local developer cockpit for Claude Code. Manages multiple repositories, runs Claude Code sessions autonomously, and exposes a responsive web/PWA interface accessible from desktop or phone.

## What it does

- Open any tracked git repository, type or speak a task
- ClaudeCTRL runs Claude Code with `--dangerously-skip-permissions` in the background
- Claude creates a feature branch, does the work, runs validation
- You come back and click Approve
- ClaudeCTRL merges to main and pushes
- Works from your desktop browser, phone, or as an installable PWA

## Prerequisites

- **Windows** (autostart uses Task Scheduler)
- **Node.js** v18+
- **Claude Code**: `npm install -g @anthropic-ai/claude-code` → run `claude` to authenticate
- **Git**: https://git-scm.com
- **GitHub CLI**: https://cli.github.com → run `gh auth login`
- **Vercel CLI** (optional): `npm install -g vercel` → `vercel login`

## Install

```bash
git clone https://github.com/Yerazikk/CLAUDECTRL
cd CLAUDECTRL
npm install
npm run setup
```

The setup script validates dependencies, creates config, and optionally installs Windows autostart.

## Configuration

Edit `config/default.yml`:

```yaml
repos:
  directory: C:/Users/me/GitHub   # your repos directory

server:
  port: 4173
```

Per-repository config: create `.devagent.yml` in any repo root:

```yaml
commands:
  test: npm test
  build: npm run build
  dev: npm run dev

agent:
  instructions: |
    This repo uses pnpm, not npm.
```

## Running

```bash
npm run dev          # start server + web client in dev mode
npm run dev:server   # server only
npm test             # run tests
```

## Windows autostart

```bash
npm run autostart:install   # install Task Scheduler task
npm run autostart:remove    # remove autostart
```

After installing, ClaudeCTRL starts automatically on login with no visible window. Logs are written to `data/server.log`.

## Connecting from desktop

Open `http://localhost:4173` in your browser.

## Connecting from phone

Install [Tailscale](https://tailscale.com) on both your PC and phone. Then open:
```
http://<your-tailscale-ip>:4173
```

ClaudeCTRL binds to `0.0.0.0` by default, so it's reachable over Tailscale without additional configuration.

Do **not** expose port 4173 to the public internet.

## PWA installation

Visit the URL in Chrome/Edge on desktop or mobile and click "Install" when prompted.

## Data

- `data/claudectrl.db` — SQLite database
- `data/server.log` — server logs
- `config/default.yml` — configuration

## Troubleshooting

- **"Claude CLI not found"**: run `claude --version` in a terminal; if missing, install it
- **"gh not authenticated"**: run `gh auth login`
- **Server won't start**: check `data/server.log`
- **Autostart not working**: check Task Scheduler for "ClaudeCTRL" task; verify the path in `scripts/start-hidden.vbs`
