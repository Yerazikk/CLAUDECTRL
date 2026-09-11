export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ParsedOutput {
  filesEdited: Array<{ path: string; linesAdded: number; linesRemoved: number }>;
  summary: string;
  currentAction: string;
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** One entry per assistant turn (last entry updated in-place while streaming) */
  assistantMessages: string[];
  /** Internal: next assistant text should start a new turn slot */
  _newTurnPending: boolean;
}

export function createParsedOutput(): ParsedOutput {
  return { filesEdited: [], summary: '', currentAction: '', toolUseCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, assistantMessages: [], _newTurnPending: false };
}

/**
 * Incrementally update a ParsedOutput with a single raw JSON line from Claude's stream-json output.
 * Mutates `parsed` in place and returns it.
 */
export function updateParsedOutput(parsed: ParsedOutput, line: string): ParsedOutput {
  try {
    const event = JSON.parse(line);

    // Assistant text messages → extract summary + track per-turn messages
    if (event.type === 'assistant' && event.message?.content) {
      const contents = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
      for (const block of contents) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const text = block.text.trim();
          if (!text) continue;
          // Extract last non-code paragraph for summary
          const paragraphs = text.split(/\n\n+/).filter(
            (p: string) => p.trim() && !p.trim().startsWith('```')
          );
          if (paragraphs.length > 0) {
            parsed.summary = paragraphs[paragraphs.length - 1].trim();
          }
          // Track full assistant text per turn
          if (parsed._newTurnPending || parsed.assistantMessages.length === 0) {
            parsed.assistantMessages.push(text);
            parsed._newTurnPending = false;
          } else {
            // Streaming update: replace last entry in-place
            parsed.assistantMessages[parsed.assistantMessages.length - 1] = text;
          }
        }
      }
    }

    // System init after first run = resume/feedback → next assistant text is a new turn
    if (event.type === 'system' && event.subtype === 'init' && parsed.assistantMessages.length > 0) {
      parsed._newTurnPending = true;
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
              const existing = parsed.filesEdited.find(f => f.path === filePath);
              if (!existing) {
                parsed.filesEdited.push({ path: filePath, linesAdded: 0, linesRemoved: 0 });
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
            parseDiffCounts(parsed, block.content);
          }
        }
      }
    }

    // Result event — capture token usage and duration
    if (event.type === 'result') {
      if (event.usage) {
        parsed.inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cache_read_input_tokens ?? 0);
        parsed.outputTokens = event.usage.output_tokens ?? 0;
      }
      if (event.duration_ms) {
        parsed.durationMs = event.duration_ms;
      }
    }

  } catch {
    // Graceful on malformed JSON — skip this line
  }

  return parsed;
}

function parseDiffCounts(parsed: ParsedOutput, text: string): void {
  // Look for +N/-M patterns in diff output
  const addMatch = text.match(/(\d+)\s*(?:insertions?|lines?\s*added|\+)/);
  const removeMatch = text.match(/(\d+)\s*(?:deletions?|lines?\s*removed|-)/);
  if ((addMatch || removeMatch) && parsed.filesEdited.length > 0) {
    const last = parsed.filesEdited[parsed.filesEdited.length - 1];
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
