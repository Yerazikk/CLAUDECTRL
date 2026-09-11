import fs from 'fs';
import path from 'path';

let logFile: fs.WriteStream | null = null;

export function initLogger(dataDir: string): void {
  const logPath = path.join(dataDir, 'server.log');
  logFile = fs.createWriteStream(logPath, { flags: 'a' });
}

function write(level: string, msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${level}] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] ${msg}`;
  if (logFile) logFile.write(line + '\n');
  if (process.env.NODE_ENV !== 'test') console.log(line);
}

export const logger = {
  info: (msg: string, data?: unknown) => write('INFO', msg, data),
  warn: (msg: string, data?: unknown) => write('WARN', msg, data),
  error: (msg: string, data?: unknown) => write('ERROR', msg, data),
  debug: (msg: string, data?: unknown) => {
    if (process.env.DEBUG) write('DEBUG', msg, data);
  },
};
