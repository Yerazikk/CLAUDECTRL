import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger';
import { broker } from '../services/events';

export interface ClaudeRunOptions {
  taskId: string;
  workDir: string;
  prompt: string;
  sessionId?: string; // Claude Code session ID to resume
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
  const { taskId, workDir, prompt, sessionId, onStatusUpdate, onSessionId, onOutput, signal } = opts;

  const args = [
    '--dangerously-skip-permissions',
    '--print',
    '--output-format', 'stream-json',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(prompt);

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
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });
    }

    let buffer = '';
    let capturedSessionId: string | null = null;
    let lastAssistantText = '';
    let resultText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
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
      const text = chunk.toString();
      logger.debug(`Claude stderr [${taskId}]: ${text.trim()}`);
    });

    proc.on('close', (code) => {
      logger.info(`Claude process for task ${taskId} exited with code ${code}`);
      resolve({
        success: code === 0,
        sessionId: capturedSessionId,
        resultText: resultText || lastAssistantText,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      });
    });

    proc.on('error', (err) => {
      logger.error(`Failed to spawn claude for task ${taskId}`, err);
      resolve({ success: false, sessionId: null, resultText: '', error: err.message });
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
    ], { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => resolve(output.trim()));
    proc.on('error', () => resolve(''));
    setTimeout(() => { proc.kill(); resolve(output.trim()); }, 30_000);
  });
}
