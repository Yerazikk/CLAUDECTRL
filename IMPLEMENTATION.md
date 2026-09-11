# ClaudeCTRL Implementation Checklist

Status: `[ ]` pending · `[~]` partial · `[x]` verified

---

## Foundation
- [x] Monorepo structure (apps/server, apps/web, packages/shared)
- [x] TypeScript clean — both server and web compile with no errors
- [x] SQLite schema with migrations (all required tables confirmed via test)
- [x] YAML config loader with Zod validation and sensible defaults
- [x] Per-repo `.devagent.yml` support with fallback detection

## Server Core
- [x] Fastify server on configurable host/port (default 0.0.0.0:4173)
- [x] WebSocket broker for live event streaming (verified via WS test)
- [x] Structured event model (task.*, session.*, git.*, preview.*, usage.*, decision.*)
- [x] Task queue with states: Queued → Working → Validating → Ready for review → Done/Failed/Stopped
- [x] Server runs independently of any browser connection
- [x] Per-repo task lock (serializes same-checkout runs; different-repo tasks concurrent)

## Claude Process Manager
- [x] Spawn `claude` with `--dangerously-skip-permissions --print --output-format stream-json`
- [x] Unset `CLAUDECODE` env var when spawning (prevents nested-session crash)
- [x] Resume sessions via `--resume <sessionId>` on feedback
- [x] Stream stdout events, parse structured JSON output
- [x] Generate concise human-readable status from Claude output
- [x] Stop/cancel individual runs without stopping server
- [x] Multiple concurrent processes across repos (different repoIds run independently)

## Repository Manager
- [x] Register repos from configured `repos.directory` (non-recursive scan)
- [x] Clone repos via `gh repo clone`
- [x] List available GitHub repos via `gh repo list` (42 repos returned in test)
- [x] Add local repos manually with path validation
- [x] HARD: No delete-repository action; "Remove from ClaudeCTRL" = DB only, no fs ops
- [x] General workspace initialized at repos.directory level

## Git Manager
- [x] Create feature/fix/refactor branches with short sanitized names (5 tests pass)
- [x] Create git worktrees for concurrent same-repo tasks
- [x] Checkpoint commits with short messages, no AI attribution
- [x] Track worktree↔task mappings in DB
- [x] Worktree cleanup after integration (no repo deletion)

## Approval / Merge Flow
- [x] On Approve: commit → merge branch into local main → push main
- [x] Auto-invoke Claude to fix merge/integration errors
- [x] Push main automatically when clean
- [x] Mark task Done, clean up worktree
- [x] User approval is not required again for auto-fix during integration

## Validation
- [x] Run configured or auto-detected test/build/lint commands after Claude finishes
- [x] On failure: Claude auto-fixes, re-validates
- [x] Surface validation failures to Claude, not immediately to user

## Preview / Dev Server
- [x] Preview registration via `registerPreview()`
- [x] HTTP proxy through ClaudeCTRL server (`/preview/:repoId/*`)
- [x] WebSocket/HMR upgrade passthrough via raw `server.on('upgrade')` handler
- [x] "Open app ↗" link in project view

## Usage Tracking
- [x] `/usage` invoked via dedicated one-shot Claude session after task completes
- [x] Periodic background refresh every 5 minutes
- [x] Parse usage into hourly/weekly windows
- [x] Usage failure never blocks development tasks (isolated from task flow)

## Prompt System
- [x] Configurable prompt files (task_wrapper, manager, general) in `prompts/`
- [x] Per-repo agent instructions injected from `.devagent.yml`
- [x] Task prompt wrapper emphasizes Claude autonomy, short non-attributed commits

## Web Client
- [x] React/Vite PWA build (builds clean in 784ms)
- [x] Service worker + manifest (PWA installable)
- [x] Dashboard: Continue / Ready for review / Recent / search
- [x] Project tabs (desktop) / back-to-dashboard navigation
- [x] Project view: branch, status, conversation, sessions, approve/stop actions
- [x] Command input: text + voice, multiline, Shift+Enter newline, Enter submits
- [x] Voice: hold-to-record, slide-up to lock, tap to stop; transcript → input (no auto-submit)
- [x] Raw terminal "View activity" expandable panel
- [x] Two thin usage bars at bottom
- [x] Ctrl+K navigates to dashboard (project palette)
- [x] WebSocket reconnect → refetch state, no task restart
- [x] PWA manifest, service worker
- [x] Notifications: fires on ready_for_review and failed status changes

## Settings UI
- [x] Health checks: Claude CLI ✓, git ✓, gh ✓, vercel (optional)
- [x] Tailscale remote access documentation in Settings page
- [x] Graceful shutdown via "Shut down ClaudeCTRL" UI action

## Windows Integration
- [x] Autostart via Task Scheduler (no terminal window; restarts on crash)
- [x] Setup script: validates deps, prompts for repos directory, installs autostart
- [x] `install-autostart.mjs install/remove` for manual control
- [x] Graceful shutdown via UI or SIGTERM/SIGINT

## Security
- [x] No public internet binding without explicit config (0.0.0.0 for LAN/Tailscale)
- [x] Repository path validation in `registerLocalRepo` (path.resolve + .git check)
- [x] "Remove from ClaudeCTRL" is DB-only — no fs deletion possible
- [x] `.env` contents never returned to clients

## Networking / Remote Access
- [x] Bind to 0.0.0.0 by default for LAN/Tailscale access
- [x] Tailscale setup documented in README and Settings UI
- [x] Preview proxy works from remote device (all traffic through ClaudeCTRL port 4173)

## Config & Secrets
- [x] `config/default.yml` checked-in, Zod-validated schema
- [x] Prefer existing CLI auth (claude, gh, vercel); no duplicate tokens required

## Testing
- [x] DB schema tests (3 tests pass)
- [x] Config loading tests (2 tests pass)
- [x] Branch naming tests (5 tests pass)
- [x] No-delete protection test
- [x] Usage parsing tests

## Documentation
- [x] README: prerequisites, install, config, dev mode, autostart, phone access, Tailscale, troubleshooting

---

## Verified End-to-End (from spec §59)

### Startup
- [x] Windows autostart installed via Task Scheduler
- [x] Server starts automatically, no browser required

### Project management
- [x] Register local repo (verified: CLAUDECTRL registered)
- [x] List GitHub repos (verified: 42 repos from gh api)
- [x] Clone from GitHub API
- [x] General workspace appears in project list

### Task flow
- [x] Task submitted via REST API
- [x] Task queued, working, validates, ready_for_review states implemented
- [x] Claude spawned with dangerously-skip-permissions + CLAUDECODE unset
- [x] Server continues working when browser disconnected

### Reconnect
- [x] WebSocket state.snapshot restores all repos/tasks on reconnect

### Preview
- [x] Preview proxy HTTP passthrough at `/preview/:repoId/*`
- [x] WebSocket/HMR upgrade passthrough

### Feedback loop
- [x] `submitFeedback` resumes Claude session via `--resume`

### Approval
- [x] Approve → commit → merge → push → Done
- [x] Auto-fix merge conflicts via Claude

### Usage
- [x] Usage tracked and displayed in two thin bars

### Concurrency
- [x] Different repos run concurrently (independent repoId locks)
- [x] Same-repo tasks serialize (per-repo lock chain)
- [x] Per-worktree isolation for true concurrency within a repo

### Client independence
- [x] No task execution depends on browser being connected
