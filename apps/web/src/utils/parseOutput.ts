export interface FileEdit {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

/** One Claude invocation (initial run, queued task, feedback, or resume) within a session */
export interface Turn {
  /** The final human-readable closing paragraph for this turn */
  summary: string;
  /** Every paragraph Claude wrote this turn (across all its messages), for the deep-dive view */
  fullText: string;
  filesEdited: FileEdit[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ParsedOutput {
  turns: Turn[];
  currentAction: string;
  toolUseCount: number;
}

function createTurn(): Turn {
  return { summary: '', fullText: '', filesEdited: [], inputTokens: 0, outputTokens: 0, durationMs: 0 };
}

function isEmptyTurn(t: Turn): boolean {
  return !t.summary && t.filesEdited.length === 0 && t.durationMs === 0;
}

export function createParsedOutput(): ParsedOutput {
  return { turns: [createTurn()], currentAction: '', toolUseCount: 0 };
}

/**
 * Incrementally update a ParsedOutput with a single raw JSON line from Claude's stream-json output.
 * Mutates `parsed` in place and returns it.
 */
export function updateParsedOutput(parsed: ParsedOutput, line: string): ParsedOutput {
  try {
    const event = JSON.parse(line);

    // Each Claude invocation (new task, queued dequeue, feedback, resume) emits its
    // own 'system init' — start a fresh turn once the current one has content.
    if (event.type === 'system' && event.subtype === 'init' && !isEmptyTurn(parsed.turns[parsed.turns.length - 1])) {
      parsed.turns.push(createTurn());
    }

    const turn = parsed.turns[parsed.turns.length - 1];

    // Assistant text messages → extract the closing paragraph for this turn
    if (event.type === 'assistant' && event.message?.content) {
      const contents = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
      for (const block of contents) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const text = block.text.trim();
          if (!text) continue;
          const paragraphs = text.split(/\n\n+/).filter(
            (p: string) => p.trim() && !p.trim().startsWith('```')
              // COMMIT:/BRANCH: metadata lines are for the server, not the user
              && !/^(COMMIT|BRANCH):/im.test(p.trim())
          );
          if (paragraphs.length > 0) {
            turn.summary = paragraphs[paragraphs.length - 1].trim();
            // Each assistant event is a distinct, already-complete message — append
            // rather than overwrite, so the deep-dive view has everything Claude said.
            turn.fullText = turn.fullText
              ? `${turn.fullText}\n\n${paragraphs.join('\n\n')}`
              : paragraphs.join('\n\n');
          }
        }
      }
    }

    // Tool use events
    if (event.type === 'assistant' && event.message?.content) {
      const contents = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
      for (const block of contents) {
        if (block.type === 'tool_use') {
          parsed.toolUseCount++;
          const name: string = block.name ?? '';
          const input = block.input ?? {};

          if (name === 'Edit' || name === 'Write') {
            const filePath: string = input.file_path ?? input.path ?? '';
            if (filePath) {
              const existing = turn.filesEdited.find(f => f.path === filePath);
              if (!existing) {
                turn.filesEdited.push({ path: filePath, linesAdded: 0, linesRemoved: 0 });
              }
            }
            parsed.currentAction = `Editing ${shortPath(filePath)}`;
          } else if (name === 'Bash') {
            const cmd = (input.command ?? '').slice(0, 60);
            parsed.currentAction = `Running: ${cmd}`;
          } else if (name === 'Read') {
            parsed.currentAction = `Reading ${shortPath(input.file_path ?? '')}`;
          } else if (name === 'Glob') {
            parsed.currentAction = `Searching files: ${input.pattern ?? ''}`;
          } else if (name === 'Grep') {
            parsed.currentAction = `Searching for: ${(input.pattern ?? '').slice(0, 40)}`;
          } else {
            parsed.currentAction = `Using ${name}`;
          }
        }
      }
    }

    // Tool results — try to parse diff line counts for Edit results
    if (event.type === 'tool_result' || (event.type === 'assistant' && event.message?.content)) {
      // Tool results sometimes come as content blocks with tool_result type
      const contents = event.content ?? event.message?.content;
      if (Array.isArray(contents)) {
        for (const block of contents) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            parseDiffCounts(turn, block.content);
          }
        }
      }
    }

    // Result event — capture token usage and duration for this turn
    if (event.type === 'result') {
      if (event.usage) {
        turn.inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cache_read_input_tokens ?? 0);
        turn.outputTokens = event.usage.output_tokens ?? 0;
      }
      if (event.duration_ms) {
        turn.durationMs = event.duration_ms;
      }
    }

  } catch {
    // Graceful on malformed JSON — skip this line
  }

  return parsed;
}

function parseDiffCounts(turn: Turn, text: string): void {
  // Look for +N/-M patterns in diff output
  const addMatch = text.match(/(\d+)\s*(?:insertions?|lines?\s*added|\+)/);
  const removeMatch = text.match(/(\d+)\s*(?:deletions?|lines?\s*removed|-)/);
  if ((addMatch || removeMatch) && turn.filesEdited.length > 0) {
    const last = turn.filesEdited[turn.filesEdited.length - 1];
    if (addMatch) last.linesAdded += parseInt(addMatch[1], 10);
    if (removeMatch) last.linesRemoved += parseInt(removeMatch[1], 10);
  }
}

function shortPath(fullPath: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : fullPath;
}

export function formatDuration(ms: number): string {
  if (!ms) return '';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}
