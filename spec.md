# CLAUDECTRL

You are building **ClaudeCTRL**, an end-to-end local developer control system for Claude Code.

Do not stop at architecture, planning, scaffolding, TODOs, mock APIs, placeholder components, or a proof of concept.

Build the entire usable V1.

You are working in a new/empty repository for this project.

The finished system must actually run on Windows, manage real repositories, launch real Claude Code CLI sessions, stream and persist their state, manage Git branches/worktrees, expose a responsive desktop/mobile web client, accept text and voice commands, continue working when the browser is closed, support manual review and automated merge/push, expose local development previews, track Claude usage, and automatically start with Windows.

---

# 1. PRODUCT GOAL

ClaudeCTRL is a **minimal multi-repository developer cockpit for Claude Code**.

The browser is only the client.

The actual work happens on a persistent local server running on the user's Windows PC.

The user should be able to open ClaudeCTRL from:

* their desktop browser
* their phone
* an installable PWA

They should be able to:

* select a repository
* talk or type to Claude
* start development work
* close the browser immediately
* let Claude continue working
* return later
* see what is running
* see what needs review
* manually test the result
* approve it
* have ClaudeCTRL merge it into `main`
* automatically push `main`

ClaudeCTRL should feel much more like talking to an engineer working on your repositories than using a developer dashboard.

---

# 2. DESIGN PRINCIPLES

The UI is extremely important.

It must be:

* slick
* minimalist
* light mode
* typography-driven
* restrained
* spacious
* responsive
* smooth
* fast
* subtle
* not visually noisy
* not a conventional enterprise dashboard
* not Jira-like
* not GitHub Actions-like
* not terminal-first
* not filled with badges, borders, cards, colors, charts, or persistent panels

Use:

* lots of negative space
* strong typography
* thin separators
* subtle gray/black status indicators
* restrained transitions
* very little permanent chrome
* sensible animation only where it improves state understanding

Technical information should be available underneath the interface but should not dominate it.

Default communication should be short, human-readable, and outcome-oriented.

---

# 3. RECOMMENDED STACK

Use this stack unless there is a concrete technical reason not to:

## Monorepo

TypeScript everywhere.

Suggested structure:

```text
CLAUDECTRL/
  apps/
    web/
    server/
  packages/
    shared/
  config/
  prompts/
  data/
  scripts/
```

Use npm workspaces unless another simple workspace solution provides a meaningful advantage.

## Frontend

* React
* TypeScript
* Vite
* responsive PWA
* light mode V1
* clean CSS architecture
* avoid unnecessary heavyweight UI libraries
* use icons sparingly
* responsive desktop/mobile layouts from one codebase

## Backend

* Node.js
* TypeScript
* Fastify
* WebSockets for live event/state streaming
* REST/HTTP APIs where appropriate
* SQLite for persistence

## External tools

Integrate with:

* Claude Code CLI
* Git CLI
* GitHub CLI (`gh`)
* Vercel CLI where applicable

Do not use the Anthropic API as the main Claude execution mechanism.

ClaudeCTRL controls the locally installed **Claude Code CLI**.

---

# 4. CLAUDE CODE EXECUTION

All Claude Code development sessions should use the installed Claude Code CLI.

Run Claude Code using:

```text
--dangerously-skip-permissions
```

ClaudeCTRL owns the process lifecycle.

It must be able to:

* create Claude sessions
* resume Claude sessions when requested
* show existing sessions
* run several Claude sessions concurrently
* stop a particular Claude run
* observe exit state
* recover cleanly from failures
* stream useful state back to the client
* keep working when no browser is connected

The server is the authority.

Never make active execution dependent on a connected frontend.

---

# 5. REPOSITORIES

ClaudeCTRL must support many Git repositories.

Do NOT recursively scan the entire filesystem looking for repositories.

There is one configurable root directory, such as:

```yaml
repos:
  directory: C:/Users/me/GitHub
```

This is where GitHub repositories normally live.

Support:

1. repositories already cloned locally
2. repositories cloned through ClaudeCTRL
3. manually registering a local repository

Use GitHub CLI authentication.

The Projects/Add Project experience should be able to use:

```bash
gh repo list
```

or the appropriate equivalent to show repositories available to the user's authenticated GitHub account.

Show whether each repository is:

* local
* not cloned
* currently working
* waiting for review
* idle

A user should be able to select a GitHub repository and click **Clone**.

Clone it into the configured repositories directory.

Also provide **Add local repository**.

---

# 6. DELETION SAFETY

Claude may delete normal source files inside a repository when that is legitimately part of a code change.

However:

**ClaudeCTRL must never delete an entire repository.**

Do not expose a Delete Repository action.

Do not allow automated deletion of:

* a repository root
* its `.git` directory
* the entire configured repository directory
* arbitrary sibling repositories

A repository may be removed from ClaudeCTRL's registry without deleting the actual files.

Distinguish:

```text
Remove from ClaudeCTRL
```

from filesystem deletion.

Filesystem deletion of entire repos is prohibited.

If Claude performs meaningful source-file deletion as part of a task, mention it in the final human-readable task summary.

---

# 7. GENERAL WORKSPACE

ClaudeCTRL has a special workspace called:

```text
General
```

General behaves similarly to a project, but its Claude Code working directory is the configured parent GitHub/projects directory.

Example:

```text
C:/Users/me/GitHub
```

This contains:

```text
C:/Users/me/GitHub/
  CLAUDECTRL/
  FLOAT/
  project-b/
  project-c/
```

General can:

* inspect multiple repositories
* work across multiple repositories
* clone repositories
* register repositories
* modify ClaudeCTRL itself
* modify ClaudeCTRL config
* modify prompts
* run commands across projects

General may NOT permanently delete entire repositories.

General does not need some separate complicated orchestration model.

Conceptually, it is a Claude Code workspace rooted at the projects parent directory with appropriate ClaudeCTRL integrations.

---

# 8. CLIENT NAVIGATION AND PROJECT TABS

The desktop UI should support **open project tabs**.

Example:

```text
FLOAT     Project B     Project C     +
```

Tabs:

* correspond to currently opened project workspaces
* can be closed
* can be reopened
* preserve server-side project/session state
* closing a tab does NOT stop Claude
* closing the browser does NOT stop Claude
* opening the project later reconnects to its state

Do not turn this into browser-style visual clutter.

The tab implementation should remain thin, clean, restrained, and compact.

On mobile, use a more space-efficient project switcher instead of forcing a full desktop tab strip.

---

# 9. DASHBOARD / HOME

The first screen should be continuity-first.

The user should not land in an empty chatbot.

It should primarily say:

```text
Select a project
```

and expose recent work.

A conceptual hierarchy:

```text
CLAUDECTRL

Continue

FLOAT
Fix lighting controller
Ready for review

Recent

Project B
feature/auth
Working

Project C
main
Last worked on yesterday
```

Possible sections:

* Continue
* Needs you / Ready for review
* Recent

Do not over-section the UI if a simpler composition looks better.

The important information is:

* what was I just doing?
* what is currently working?
* what needs me?
* what projects have I recently used?

Include project search because the user may have many repositories.

---

# 10. PROJECT VIEW

The repository is the main object, not a terminal session.

A project page might conceptually contain:

```text
FLOAT

feature/fix-controller

Working

Claude
Fixing the controller reset.

[short conversation/status]

Open app ↗

Tell Claude what to do...
```

Project pages should expose:

* current branch
* current task
* concise status
* conversation
* active runs
* previous Claude sessions
* preview/dev server if available
* Ready for review state
* approval action
* raw activity/terminal when explicitly opened

Do not permanently display a giant terminal.

---

# 11. CLAUDE SESSIONS

Each repository may have multiple Claude Code sessions.

Do not maintain exactly one huge permanent conversation forever.

The UI should let the user see sessions associated with a repository and reopen/resume them where Claude Code supports it.

New tasks may create new sessions.

Do NOT manufacture large ClaudeCTRL session summaries to inject into every new Claude session.

Do NOT automatically replay entire conversation histories into a fresh Claude session.

Claude Code's own repository/context behavior is sufficient unless a task explicitly requires resuming a previous session.

Persist metadata about sessions in ClaudeCTRL.

Example:

```text
Sessions

● Fix controller reset
  active

○ Add color presets
  yesterday

○ Initial setup
  Sep 8
```

---

# 12. MULTIPLE CONCURRENT CLAUDE PROCESSES

ClaudeCTRL must support multiple Claude Code processes at once.

Examples:

* FLOAT may be working
* Project B may be working
* Project C may be waiting
* General may also have a running task

The architecture must not globally serialize all Claude work.

---

# 13. MULTIPLE ACTIVE TASKS IN ONE REPOSITORY

A repository may have multiple genuinely active Claude Code sessions simultaneously **when they are isolated with Git worktrees**.

Example:

```text
FLOAT

● Fix RGB controller
● Refactor Bluetooth service
○ Previous calibration task
```

Do not allow multiple processes to independently modify the exact same checkout concurrently.

For truly separate active tasks:

* create separate branches
* create isolated Git worktrees
* associate each task/session with its own worktree
* track those mappings
* safely clean up worktrees after integration without deleting the repository

A single user command containing several related bugs should NOT automatically become multiple top-level sessions.

That behavior is covered separately below.

---

# 14. MULTI-BUG / MULTI-TASK COMMANDS

The user may say something like:

```text
Fix these three things:
1. light doesn't turn off
2. settings modal clips
3. reset button crashes
```

For one project command like this:

* create/use one primary Claude Code session
* give the complete task to the primary session
* allow Claude to determine whether subagents are worthwhile

The command wrapper must explicitly tell Claude to use subagents intelligently.

It should NOT blindly create subagents for everything.

The configuration should permit wording similar to:

```text
When a request contains several independent tasks, decide whether
parallel subagents will improve speed, correctness, or context isolation.

Use subagents for independent or substantial work when useful.

For small bugs or tightly related work, handle them sequentially in the
primary session when that will be simpler and use fewer tokens.

Optimize for correctness, speed, and reasonable token usage rather than
maximizing agent count.
```

This prompt must be configurable.

---

# 15. COMMAND WRAPPING

Typed commands and voice commands use the **same command pipeline**.

Do NOT create separate behavioral wrappers for voice versus typing.

The user's raw text should be combined with configurable ClaudeCTRL instructions.

Support something conceptually like:

```yaml
prompts:
  task_wrapper: ./prompts/task.md
  general: ./prompts/general.md
  manager: ./prompts/manager.md
```

And optional per-repo instructions.

ClaudeCTRL should be able to evolve prompt behavior without editing application code.

---

# 16. CLAUDE BEHAVIOR

The Claude task wrapper should strongly prefer autonomy.

Routine engineering decisions do not require asking the user.

Claude should normally be allowed to:

* inspect files
* edit files
* create files
* delete obsolete files
* install normal dependencies
* run tests
* run builds
* run linters
* start development servers
* create branches
* create checkpoint commits
* use Git worktrees
* use subagents
* fix its own errors

Do not interrupt the user for normal implementation choices.

Only surface a decision when it is genuinely meaningful, such as:

* major product ambiguity
* potentially destructive change
* security-sensitive decision
* major architecture decision with multiple valid outcomes
* expensive external operation
* irreversible action

Even then:

* explain it briefly
* recommend an option
* permit conversational response

Avoid:

```text
Would you like me to inspect the file?
Would you like me to run tests?
Would you like me to fix this?
```

Claude should simply do routine engineering work.

---

# 17. HUMAN-READABLE OUTPUT

The main UI should NOT dump all Claude terminal output.

It should show short human-readable updates.

Bad:

```text
Reading src/components/Button.tsx...
Using Edit...
Modified 14 lines...
Running grep...
Token output...
```

Better:

```text
Fixing the controller reset.
```

Completion example:

```text
Fixed it.

The reset handler was firing twice.
Ready for you to test.
```

Another:

```text
Fixed all three.

The layout bug came from the mobile container width.
Also removed the old unused settings component.

Ready for you to test.
```

Keep explanations short.

The user generally does not care:

* exactly which files Claude read
* every dependency operation
* every intermediate tool invocation
* every implementation detail

They do care about:

* what was fixed
* why, briefly
* whether something important was deleted
* whether tests passed
* whether it is ready to manually test
* whether Claude needs them

---

# 18. RAW TERMINAL / ACTIVITY

Although it is not the default experience, technical details must still be available.

Provide an expandable:

```text
View activity
```

or:

```text
Terminal
```

surface.

It should expose the real streamed Claude Code/process output sufficiently for debugging.

Where technically feasible, provide an interactive terminal-like view for direct input into an active Claude Code process/session.

Do not let terminal rendering dominate the product interface.

---

# 19. STRUCTURED SERVER EVENTS

Do not rely purely on parsing natural-language terminal output to determine application state.

Create a clear internal protocol/event model between Claude execution and ClaudeCTRL.

The server should maintain structured concepts such as:

```text
task.created
task.started
task.status
task.ready_for_review
task.failed

session.started
session.resumed
session.stopped

git.branch_created
git.commit_created

preview.started
preview.stopped

decision.requested

usage.updated
```

The exact implementation may differ, but UI state must not depend on fragile prose guessing.

Where Claude must communicate structured information, create a robust mechanism that coexists with normal Claude Code execution.

---

# 20. TASK QUEUE

Commands should be queueable.

If Claude is already working and the user submits another command, do not simply discard it.

Represent queued work clearly but minimally.

Possible states:

```text
Queued
Working
Validating
Ready for review
Done
Failed
Stopped
```

A user must be able to cancel/stop queued or active work appropriately.

---

# 21. STOPPING WORK

There must be two distinct concepts:

## Stop run

Stops/cancels the active Claude task/process.

This does NOT shut down ClaudeCTRL.

## Shut down ClaudeCTRL

Stops the entire backend/server intentionally.

Do not conflate these controls.

---

# 22. SERVER INDEPENDENCE FROM CLIENT

This is a hard requirement.

Once the user presses Send and the server acknowledges the command:

**the client is no longer required for execution.**

The user can:

* close the tab
* close the browser
* close the PWA
* switch devices

Claude continues working.

All task execution, queues, process ownership, logs, branch information, status, and persistence belong to the server.

When the client reconnects, it fetches current state and resumes WebSocket updates.

Do not make browser JavaScript responsible for keeping Claude alive.

---

# 23. PERSISTENCE

Use SQLite.

Persist enough state that server/browser restarts do not make the interface forget what happened.

At minimum store concepts equivalent to:

```text
repositories
sessions
tasks
task_queue
runs
messages
decisions
branches
worktrees
commits
previews
usage_snapshots
git_events
settings metadata
```

For each repository/task, retain useful fields such as:

* repository path
* GitHub identity
* current branch
* associated worktree
* Claude session identifier
* task title
* status
* last human message
* last concise Claude result
* pending decisions
* start/end timestamps
* last activity
* preview URL
* commit identifiers
* latest relevant run logs

Do not depend on Claude's memory as the product database.

---

# 24. GIT BRANCH STRATEGY

Features should normally map to branches.

Claude decides whether a request:

* belongs to the current active feature
* deserves a new feature branch
* is a fix
* is a refactor

Suggested patterns:

```text
feature/password-reset
fix/mobile-navbar
refactor/auth-service
```

Branch names must remain short and readable.

Do not create a new branch for every tiny follow-up message if it clearly belongs to the existing task.

Do not normally develop directly on `main`.

---

# 25. COMMITS

Claude may make sensible checkpoint commits while developing.

Commit messages must be very short.

Good:

```text
fix mobile navbar
add password reset
handle expired sessions
update event parser
```

Avoid verbose AI-generated commit messages.

Do not require conventional commits in V1.

Never include AI/Claude attribution.

Explicitly prohibit:

```text
Co-Authored-By: Claude
Generated with Claude Code
Generated by AI
AI-assisted
Claude contribution
```

No bot emoji/footer.

Commit history should look like normal human development history.

---

# 26. VALIDATION

Claude performs its own automated engineering validation before presenting work for human review.

Depending on the repository, this may include:

* tests
* typecheck
* lint
* build
* relevant project-specific commands

If validation fails:

**Claude should attempt to fix it automatically.**

Do not immediately bother the user.

Continue fixing until either:

* validation succeeds, or
* there is a genuine blocker that requires user input

Repository-specific config should support commands such as:

```yaml
commands:
  test: npm test
  build: npm run build
  lint: npm run lint
  dev: npm run dev
```

If commands are not configured, intelligently detect appropriate project commands.

---

# 27. HUMAN REVIEW FLOW

Claude's automated tests are not the final approval.

The user manually tests the result.

Task lifecycle:

```text
Queued
  ↓
Working
  ↓
Validating
  ↓
Ready for review
  ↓
User manually tests
```

At **Ready for review**, show a clear but minimal action:

```text
Approve
```

and keep the command box available for feedback.

If the user says:

```text
the mobile button still clips
```

the same task returns to:

```text
Working
→ Validating
→ Ready for review
```

Reuse the same branch/session when appropriate.

---

# 28. APPROVAL / MERGE FLOW

There is no GitHub PR requirement.

Do not create a PR as part of the normal flow.

When the user clicks **Approve**:

1. confirm the task/worktree is in a valid state
2. ensure relevant work is committed
3. merge the task branch into local `main`
4. if merge/build/integration errors occur, automatically invoke Claude to resolve them
5. re-run relevant validation
6. once clean, push `main` automatically
7. mark task Done
8. safely clean up associated worktree when appropriate

The user should **not need to approve a second time** merely because merge integration needed automatic fixes.

After the initial Approve action, ClaudeCTRL owns integration through successful push unless a genuinely ambiguous/destructive blocker appears.

Conceptually:

```text
Approve
↓
merge into main
↓
error?
   yes → Claude fixes integration
          ↓
          validate again
↓
push main
↓
Done
```

Do not require a PR review.

---

# 29. DEV SERVER / PREVIEW

When Claude launches the repository's development server or otherwise has a testable web target, ClaudeCTRL should detect/register it.

Show something minimal like:

```text
Open app ↗
```

The user should be able to click it and open the running application in a new browser tab.

Support local preview metadata such as:

```text
preview:
  type: local
  url: http://localhost:5173
```

Do not assume the user is accessing ClaudeCTRL from the PC.

If the user opens ClaudeCTRL from their phone, `localhost:5173` would incorrectly refer to their phone.

Therefore implement a safe way for local project preview URLs to work through remote ClaudeCTRL access as well.

Possible solutions include:

* reverse proxy through ClaudeCTRL
* mapped host address
* another robust proxy approach

Prefer a transparent solution so **Open app** works from PC or phone.

Preserve WebSockets/HMR where reasonably possible.

---

# 30. VERCEL

Support Vercel integration for repositories where appropriate.

Use the locally authenticated Vercel CLI where possible.

ClaudeCTRL may surface Vercel preview URLs.

Production deployment must not occur accidentally.

Use config to control deployment autonomy.

Vercel integration should not make non-Vercel projects fail.

---

# 31. VOICE INPUT

V1 uses browser speech recognition/Web Speech APIs where supported.

Do not introduce an external transcription API unless needed later.

Text and voice result in the same underlying task submission.

Voice interaction:

## Idle

```text
[ Tell Claude what to do...      mic ]
```

## Hold microphone

Holding the microphone transitions the input into a recording/listening state.

Conceptually:

```text
[          Listening...          ]
```

## Lock

While holding, the user can slide/pull upward to lock recording.

Once locked, they may release their finger without ending the recording.

## Finish locked recording

Tap again to stop/unlock.

After recording stops:

* transcribe speech
* place transcript into the normal text input
* DO NOT submit automatically

The user may:

* review it
* edit it
* press Send

Do not execute tasks merely because recording stopped.

This interaction must work well on touch devices.

Provide graceful fallback where browser speech APIs differ.

---

# 32. TEXT INPUT

Text input is first-class.

The command box should support:

* typing
* pasted stack traces/errors
* multiline text
* voice transcription
* keyboard submission
* obvious but minimal Send action

Do not make the app visually look like a voice recorder.

---

# 33. NOTIFICATIONS

Support notifications for important events such as:

* Ready for review
* task failed
* Claude needs a decision
* deployment/preview ready where useful

Build the web client as an installable PWA.

Implement notifications cleanly and with progressive enhancement.

Where practical, support notifications even when the normal UI is not currently focused/open.

Do not make notifications required for task execution.

---

# 34. REMOTE PHONE ACCESS

Phone access is a V1 requirement.

The system runs on the user's Windows PC and should be safely reachable from their phone.

Use a secure private-network approach suitable for a personal local development server.

Tailscale is an acceptable/recommended implementation target.

Keep networking sufficiently abstract that the app itself is not permanently coupled to one provider.

Do NOT casually expose an unauthenticated Claude Code control server to the public internet.

For V1:

* support secure remote/private access
* do not require a normal username/password login screen
* preserve encrypted transport
* document setup clearly

If Tailscale is the cleanest reliable solution, support/document it.

---

# 35. USAGE TRACKING

ClaudeCTRL should surface Claude Code subscription usage.

After a user task/prompt completes, automatically update usage.

The intended behavior is similar to running:

```text
/usage
```

in Claude Code.

Do NOT consume a normal Claude model prompt merely to determine usage if there is a supported/non-token-consuming method.

Investigate the installed Claude Code CLI and use the most reliable supported mechanism available.

If `/usage` requires an interactive Claude terminal:

* isolate usage retrieval from development sessions
* maintain a dedicated lightweight usage process/session if needed
* trigger it after task completion
* parse the resulting usage information robustly
* do not contaminate project conversations with usage checks

Also update usage periodically when sensible.

Usage tracking failure must never break development tasks.

---

# 36. USAGE UI

Usage visualization must be extremely subtle.

Near the bottom of the interface, show **two thin stacked horizontal usage bars**.

For example:

```text
───────────────
4h remaining

────────────────────
5d remaining
```

One represents the shorter approximately five-hour usage window.

One represents the weekly usage window.

Visual requirements:

* very thin
* gray/black
* no colorful progress visualization
* no charts
* no big usage card
* understated
* gradually fills according to usage
* short labels only

Examples:

```text
4h remaining
```

and:

```text
5d remaining
```

Use actual available data rather than hardcoding these exact strings.

If usage data includes reset timestamps rather than convenient remaining-time labels, derive an appropriate concise label.

---

# 37. STATUS COMMUNICATION

The main project state should be easy to understand at a glance.

Use concise states such as:

```text
Working
Queued
Validating
Ready for review
Waiting for you
Stopped
Failed
Done
```

Avoid excessive status colors.

Typography, subtle dots, and text are preferable.

---

# 38. ACTIVITY AFTER BROWSER RECONNECT

When the browser reconnects:

* fetch authoritative state from the server
* restore open/recent project state where useful
* show active tasks
* show queued tasks
* show Ready for review tasks
* resume live event streams

Do not restart tasks because a client reconnects.

---

# 39. WINDOWS AUTOSTART

ClaudeCTRL must automatically start with Windows in V1.

The normal experience should be:

```text
Turn on PC
↓
ClaudeCTRL server starts automatically
↓
repos/state restored
↓
server waits quietly
↓
open browser or phone when desired
```

No visible terminal window should be required during normal use.

Implement a robust Windows startup mechanism.

Possible implementations include:

* Windows Task Scheduler
* a suitable Windows service wrapper
* another dependable startup strategy

Requirements:

* setup/install script
* starts automatically
* survives client closure
* restarts after unexpected crash where feasible
* easy manual development start command
* clear logs for troubleshooting

Do not require the user to manually launch `npm run server` after every reboot.

---

# 40. SERVER SHUTDOWN

Expose a deliberate:

```text
Shut down ClaudeCTRL
```

action in an appropriately tucked-away location.

When intentionally shut down:

* gracefully stop work/processes or clearly handle active work
* shut down the server
* remain off for the current session unless manually relaunched
* normal autostart can occur again on next Windows boot/login

Do not provide a normal UI switch that permanently disables autostart.

No LeagueClient process detection is needed.

---

# 41. CLAUDECTRL SELF-DEVELOPMENT

General can modify ClaudeCTRL itself.

Example request:

```text
Make the project tabs smaller on mobile.
```

Claude Code may modify the ClaudeCTRL repository.

Because the running server may be modifying itself:

* do not blindly restart while unrelated jobs are running
* detect pending server restart
* provide a clean/graceful restart strategy
* surface a minimal `Restart ClaudeCTRL` action when needed
* preserve persistent task state
* reconnect clients after restart where possible

Self-update must not corrupt active repository work.

---

# 42. CONFIGURATION

ClaudeCTRL must be heavily configuration-driven.

Use normal checked-in config for non-secret settings and `.env` for secrets.

Example:

```yaml
server:
  host: 0.0.0.0
  port: 4173

repos:
  directory: C:/Users/me/GitHub

agent:
  provider: claude-code
  permission_mode: dangerously-skip-permissions

prompts:
  task_wrapper: ./prompts/task.md
  manager: ./prompts/manager.md
  general: ./prompts/general.md

voice:
  enabled: true
  provider: browser

git:
  branch_strategy: feature

  branch_prefixes:
    feature: feature/
    bugfix: fix/
    refactor: refactor/

  commits:
    enabled: true
    style: short
    max_subject_length: 50
    conventional_commits: false
    ai_attribution: false

  approval:
    merge_to_main: true
    push_main: true

vercel:
  enabled: true

notifications:
  enabled: true
```

Adapt this schema as implementation realities become clearer.

Use a proper validated config schema.

Provide sensible defaults.

Config errors should be actionable.

Support reload without server restart where practical.

---

# 43. SECRETS

Secrets should not live in normal checked-in YAML.

Use:

```text
.env
```

for secrets when necessary.

Prefer existing CLI authentication where possible:

* Claude Code's existing login
* `gh` CLI authentication
* Vercel CLI authentication

Avoid requiring duplicate tokens when the local CLI already has valid authentication.

---

# 44. PER-REPOSITORY SETTINGS

Support optional repo-specific config.

For example:

```text
.devagent.yml
```

or a clearly named ClaudeCTRL config file.

Example:

```yaml
commands:
  test: npm test
  build: npm run build
  dev: npm run dev

agent:
  instructions: |
    This repo uses pnpm.
    Do not edit generated migrations manually.
```

Do not require this file for every repository.

Detection/fallbacks should make repos usable immediately.

---

# 45. SETTINGS UI

Provide a small minimalist Settings surface.

Do not build a giant admin panel.

Expose essential controls such as:

* repo directory
* notifications
* voice
* network/remote-access status
* usage status
* Vercel availability
* Claude CLI availability
* GitHub CLI availability
* configurable prompt access where practical

Advanced settings can be represented through config files.

General should also be capable of editing ClaudeCTRL's config conversationally.

---

# 46. CONNECTION / HEALTH

The browser should make server connection status obvious but subtle.

Example:

```text
connected
```

or a tiny status indicator.

Handle temporary disconnect gracefully.

If the server restarts:

* reconnect automatically
* refetch current state
* do not lose submitted work

---

# 47. ERROR HANDLING

Build real failure handling.

Account for:

* Claude CLI not installed
* Claude CLI authentication missing
* Git not installed
* `gh` not authenticated
* Vercel unavailable
* repository path missing
* dirty main branch
* merge conflict
* dev server port conflict
* Claude process crash
* task cancellation
* malformed config
* SQLite initialization failure
* worktree failure
* remote client disconnect
* WebSocket reconnect

Show errors in human-readable language.

Do not expose huge Node stack traces in the normal UI.

Keep detailed logs available for debugging.

---

# 48. SECURITY

This application can execute arbitrary development commands on the host machine, so do not casually treat it like a normal public web app.

Requirements:

* no public internet binding without an explicit secure strategy
* document remote-access assumptions
* validate repository paths
* prevent path tricks from turning "remove project" into directory deletion
* protect sensitive config
* never expose `.env` contents to clients unnecessarily
* never return arbitrary filesystem contents through APIs without repository/path validation
* prevent arbitrary browser clients from invoking repository deletion
* preserve the hard no-delete-repository rule

Do not cripple legitimate Claude Code development work with excessive sandboxing; instead secure the remote control surface correctly.

---

# 49. DATA MODEL

Design a clean SQLite schema.

Do not blindly copy this, but cover these concepts:

```text
repositories
sessions
tasks
runs
messages
decisions
worktrees
previews
usage_snapshots
git_events
app_state
```

Use migrations.

Keep state transitions explicit.

Avoid storing critical state only in in-memory JavaScript objects.

---

# 50. SERVER ARCHITECTURE

Keep responsibilities separated.

A reasonable architecture may include:

```text
Claude Process Manager
Repository Manager
Git Manager
Worktree Manager
Task Queue
Session Manager
Preview Manager
Usage Manager
Notification Manager
Config Loader
Persistence Layer
WebSocket/Event Broker
Windows Startup Manager
```

Do not create abstraction purely for abstraction's sake.

The codebase should remain understandable.

---

# 51. PERFORMANCE

This runs continuously on a personal Windows PC.

It should be idle-efficient.

Do not burn CPU by:

* constant aggressive polling
* repeatedly scanning filesystem trees
* repeatedly spawning Claude unnecessarily
* rendering huge terminal histories
* updating the client dozens of times per second without need

Use event-driven behavior where practical.

The user specifically wants to be able to leave the server running continuously.

---

# 52. UI POLISH

Do not consider V1 finished if it technically works but looks like an admin template.

Spend real effort on polish.

Requirements:

* good spacing
* responsive typography
* desktop tabs
* elegant mobile project switching
* smooth project transitions
* polished command input
* polished hold/lock voice gesture
* subtle loading states
* concise empty states
* clear Ready for review state
* excellent touch targets without looking oversized
* proper focus/keyboard behavior
* project search/command palette
* no generic Bootstrap/dashboard appearance

Use real task states in the interface rather than fake demo content once backend integration exists.

---

# 53. DESKTOP EXAMPLE

Do not copy this literally; it illustrates density:

```text
CLAUDECTRL

FLOAT     Project B     Project C    +

FLOAT
fix/controller-reset

Working

Fixing the reset issue.

────────────

Tell Claude what to do...                 mic  ↑


                               4h remaining
                               ━━━━━────────

                               5d remaining
                               ━━━──────────
```

Very little permanent UI.

---

# 54. READY FOR REVIEW EXAMPLE

```text
FLOAT
fix/controller-reset

Ready for review

Fixed it.

The old reset listener was firing twice.

Open app ↗

[ Approve ]

Tell Claude what to do...
```

The user can manually test.

If they discover another issue, they type it directly into the same input.

---

# 55. DASHBOARD EXAMPLE

Conceptually:

```text
CLAUDECTRL

Select a project


Continue

FLOAT
Controller reset
Ready for review


Recent

Project B
Working

Project C
Yesterday

General
```

Again: do not make unnecessary bordered cards everywhere.

---

# 56. PROJECT SEARCH

Many repositories may exist.

Search should be fast and prominent enough to use without maintaining a huge sidebar.

Desktop may support a command palette shortcut such as:

```text
Ctrl+K
```

Mobile can use the project name/project picker.

---

# 57. ACCESSIBILITY / INPUT QUALITY

Implement:

* correct keyboard navigation
* visible focus states
* ARIA where required
* reduced motion respect where appropriate
* usable touch controls
* clear microphone permissions behavior
* command submission that does not accidentally send multiline messages
* reconnect feedback
* notification permission handling

Minimalist does not mean inaccessible.

---

# 58. TESTING CLAUDECTRL ITSELF

Write meaningful automated tests for ClaudeCTRL.

At minimum test core logic around:

* task lifecycle
* queue behavior
* repo registration
* protected no-delete behavior
* branch naming
* worktree mapping
* merge approval workflow
* persistence
* WebSocket/event state
* config parsing
* usage parsing where feasible

Use mocks/fakes for external CLIs in unit/integration testing where required.

Also perform real manual integration validation against installed CLIs when available.

---

# 59. END-TO-END ACCEPTANCE REQUIREMENTS

Do not call the project finished until the following workflow is operational.

## Startup

1. Windows starts.
2. ClaudeCTRL backend starts automatically.
3. No frontend/browser is required.

## Add project

4. User opens ClaudeCTRL.
5. Opens Add Project.
6. GitHub repositories can be shown through authenticated GitHub CLI.
7. User clones or registers a repo.
8. Project appears on dashboard.

## Work

9. User opens project.
10. Types or dictates a command.
11. Command reaches server.
12. User may immediately close browser.
13. Server starts Claude Code with `--dangerously-skip-permissions`.
14. Claude works independently.
15. Claude runs appropriate validation.
16. Claude produces concise completion information.
17. Task becomes Ready for review.

## Reconnect

18. User opens ClaudeCTRL later, possibly from another device.
19. Project status is still present.
20. Current task/session information is correct.

## Manual testing

21. If a dev server exists, user can click Open app.
22. Preview works from an appropriate connected device, including remote phone access where configured.
23. User manually tests.

## Feedback

24. User can submit follow-up changes.
25. Claude resumes development.
26. Returns to Ready for review.

## Approval

27. User clicks Approve.
28. Task branch integrates into local `main`.
29. Merge/integration failures automatically invoke Claude to fix them.
30. Validation reruns.
31. `main` is automatically pushed when clean.
32. Task becomes Done.

## Usage

33. Claude usage refreshes after task completion.
34. Two subtle usage bars update.

## Concurrency

35. Different projects can run concurrently.
36. Same-project simultaneous independent sessions are isolated via worktrees.

## Client independence

37. Closing every browser window does not terminate Claude tasks.

If any of these only works in a mock/demo path, the implementation is incomplete.

---

# 60. DOCUMENTATION

Create a concise README covering:

* what ClaudeCTRL is
* Windows prerequisites
* Node version
* Claude Code installation/authentication
* Git installation
* GitHub CLI authentication
* Vercel setup if used
* initial install
* config
* running development mode
* installing Windows autostart
* connecting from desktop
* connecting from phone
* recommended secure remote/Tailscale setup
* troubleshooting
* data/config locations

Do not fill README with marketing language.

---

# 61. INSTALL / SETUP EXPERIENCE

Aim for something close to:

```bash
git clone ...
cd CLAUDECTRL
npm install
npm run setup
```

Setup should:

* validate dependencies
* create default config if absent
* initialize database
* create required directories
* prepare Windows autostart
* explain missing CLI authentication
* avoid destroying existing config

Provide normal commands such as:

```bash
npm run dev
npm run build
npm test
```

Exact names may differ if there is a good reason.

---

# 62. IMPLEMENTATION APPROACH

You may plan internally before coding, but do not stop after producing the plan.

Work systematically through the application.

Inspect your work continuously.

Run commands.

Fix errors.

Continue until the complete V1 works.

Do not ask the user routine implementation questions.

Make reasonable engineering decisions yourself.

If an exact external CLI behavior is uncertain, inspect the locally installed CLI/help/documentation available to you rather than inventing an API.

Examples:

```bash
claude --help
gh --help
vercel --help
git --help
```

Especially investigate the actual installed Claude Code behavior for:

* creating sessions
* resuming sessions
* interactive process control
* slash commands
* `/usage`
* machine-readable output options
* permission flags

Build against real capabilities.

Do not fabricate unsupported Claude Code flags.

---

# 63. QUALITY BAR

This is intended to become a real portfolio/recruiter-visible software project.

Code quality should reflect that.

Requirements:

* clean TypeScript
* coherent architecture
* no giant god files
* no obviously generated repetitive boilerplate
* no fake implementations
* useful comments only
* robust process cleanup
* schema validation
* migrations
* sensible tests
* clear naming
* polished interaction design
* clean Git history

Do not add Claude attribution to commits.

---

# 64. FINAL EXECUTION INSTRUCTION

Start implementing now.

You have authority to install normal project dependencies, create the project structure, write the code, run builds/tests, and make implementation decisions.

Do not return with only:

* a proposed architecture
* a requirements document
* a TODO list
* a list of files to create
* pseudocode
* a partial frontend
* a mocked Claude backend
* a nonfunctional prototype

Continue through implementation and validation.

At the end, provide only a concise report containing:

1. what is implemented
2. what commands were successfully tested
3. any external setup that genuinely requires the user, such as logging into a CLI or installing Tailscale
4. any known remaining limitation that cannot reasonably be completed without that external action

The target is a **working ClaudeCTRL V1**, not a plan for one.
chat clone.

ClaudeCTRL UI — A responsive desktop/mobile web client centered around projects, active work, and communication with Claude Code.

Home: “Last worked on” at the top, followed by repos that are active, waiting for input, or recently used.
Repo workspace: Shows the current feature/task, Git branch, Claude status, recent commits, changed files, test/build status, and deployment/preview link.
Conversation: Clean chronological feed of your instructions and Claude’s important updates. Internal tool calls and noisy logs stay hidden unless expanded.
Input: One persistent text field with a microphone button. Typing and voice use the same workflow.
Decisions: When Claude needs input, the question becomes visually prominent with simple choices, while still allowing a typed/spoken response.
Repo switcher: Fast searchable switcher for jumping between repositories, with current branch and status visible.
Activity: Expandable technical view for commands, file edits, test output, Git operations, and Claude activity.
Branches: Feature branches are visible as part of the workspace rather than buried in Git controls.
Responsive: Same web client on PC and phone. Desktop uses the extra space for project/activity context; mobile strips down to the current task, conversation, and input.
Visual style: Large typography, lots of whitespace, monochrome/neutral palette, thin dividers, subtle