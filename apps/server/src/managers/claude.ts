import { spawn, ChildProcess, execSync } from 'child_process';
import { logger } from '../utils/logger';
import { broker } from '../services/events';

// Kill if no stdout for this long — Claude actively working always produces output
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of silence = stuck

function killProc(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid) {
    // shell:true means proc is cmd.exe — taskkill /T kills the whole tree
    try { execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'pipe' }); } catch {}
  } else {
    try { proc.kill('SIGTERM'); } catch {}
  }
}

export interface ClaudeRunOptions {
  taskId: string;
  workDir: string;
  prompt: string;
  sessionId?: string; // Claude Code session ID to resume
  model?: string; // Claude model alias/name (e.g. 'opus', 'sonnet', 'haiku')
  onStatusUpdate?: (status: string) => void;
  onSessionId?: (sessionId: string) => void;
  onOutput?: (line: string) => void;
  signal?: AbortSignal;
}

export interface ClaudeRunResult {
  success: boolean;
  sessionId: string | null;
  resultText: string;
  error?: string;
}

// Parse stream-json output from Claude Code
interface ClaudeStreamEvent {
  type: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }> | string;
  };
  result?: string;
  error?: string;
  subtype?: string;
  is_error?: boolean;
}

function extractText(content: ClaudeStreamEvent['message']): string {
  if (!content) return '';
  const c = content.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const { taskId, workDir, prompt, sessionId, model, onStatusUpdate, onSessionId, onOutput, signal } = opts;

  const args = [
    '--dangerously-skip-permissions',
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  if (model && model !== 'default') {
    args.push('--model', model);
  }

  // Prompt is written to stdin to avoid Windows cmd.exe mangling of
  // multiline/special-character strings when shell:true is used.

  // CRITICAL: Unset CLAUDECODE so nested sessions don't crash
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  logger.info(`Spawning Claude for task ${taskId} in ${workDir}`);

  return new Promise((resolve) => {
    const proc = spawn('claude', args, {
      cwd: workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let resolved = false;
    const finish = (result: ClaudeRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    // Inactivity timeout — kill only if no stdout for N minutes.
    // This lets complex long-running tasks finish while catching genuinely stuck processes.
    let timeoutHandle = setTimeout(onInactivityTimeout, INACTIVITY_TIMEOUT_MS);
    function resetInactivityTimer() {
      clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(onInactivityTimeout, INACTIVITY_TIMEOUT_MS);
    }
    function onInactivityTimeout() {
      logger.warn(`Claude task ${taskId} produced no output for ${INACTIVITY_TIMEOUT_MS / 60000} minutes, killing`);
      killProc(proc);
      finish({ success: false, sessionId: capturedSessionId, resultText: resultText || lastAssistantText, error: 'Claude stopped responding (no output for 5 minutes)' });
    }

    // Write prompt to stdin and close it so Claude knows input is done
    proc.stdin.write(prompt);
    proc.stdin.end();

    if (signal) {
      signal.addEventListener('abort', () => killProc(proc));
    }

    let buffer = '';
    let capturedSessionId: string | null = null;
    let lastAssistantText = '';
    let resultText = '';
    let stderrText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      resetInactivityTimer(); // Claude is alive, reset the silence detector
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (onOutput) onOutput(trimmed);
        broker.publish({ type: 'task.output', taskId, line: trimmed });

        try {
          const event: ClaudeStreamEvent = JSON.parse(trimmed);

          if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
            capturedSessionId = event.session_id;
            if (onSessionId) onSessionId(event.session_id);
          }

          if (event.type === 'assistant' && event.message) {
            const text = extractText(event.message);
            if (text) {
              lastAssistantText = text;
              const statusLine = text.split('\n')[0].slice(0, 120);
              if (onStatusUpdate) onStatusUpdate(statusLine);
            }
          }

          if (event.type === 'result') {
            resultText = event.result ?? lastAssistantText;
          }
        } catch {
          // Not JSON - raw output line, emit as-is
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        stderrText += text + '\n';
        logger.warn(`Claude stderr [${taskId}]: ${text}`);
      }
    });

    proc.on('close', (code) => {
      logger.info(`Claude process for task ${taskId} exited with code ${code}`);
      const errMsg = code !== 0
        ? (stderrText.trim() || `Process exited with code ${code}`)
        : undefined;
      finish({
        success: code === 0,
        sessionId: capturedSessionId,
        resultText: resultText || lastAssistantText,
        error: errMsg,
      });
    });

    proc.on('error', (err) => {
      logger.error(`Failed to spawn claude for task ${taskId}`, err);
      const friendlyMsg = err.message.includes('ENOENT')
        ? 'Claude CLI not found. Make sure Claude Code is installed and "claude" is in your PATH.'
        : err.message;
      finish({ success: false, sessionId: null, resultText: '', error: friendlyMsg });
    });
  });
}

// Lightweight usage query using a one-shot session
export async function queryUsage(workDir: string): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve) => {
    const proc = spawn('claude', [
      '--dangerously-skip-permissions',
      '--print',
      '--output-format', 'json',
      '/usage',
    ], { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });

    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => resolve(output.trim()));
    proc.on('error', () => resolve(''));
    setTimeout(() => { killProc(proc); resolve(output.trim()); }, 30_000);
  });
}
