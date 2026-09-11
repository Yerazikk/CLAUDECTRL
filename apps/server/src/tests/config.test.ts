import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../utils/config';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('config loader', () => {
  it('loads defaults when no file exists', () => {
    const cfg = loadConfig('/nonexistent/path.yml');
    expect(cfg.server.port).toBe(4173);
    expect(cfg.server.host).toBe('0.0.0.0');
    expect(cfg.git.commits.ai_attribution).toBe(false);
  });

  it('loads from YAML file', () => {
    const tmp = path.join(os.tmpdir(), `test-cfg-${Date.now()}.yml`);
    fs.writeFileSync(tmp, `
server:
  port: 9999
repos:
  directory: /tmp/repos
`);
    const cfg = loadConfig(tmp);
    expect(cfg.server.port).toBe(9999);
    expect(cfg.repos.directory).toBe('/tmp/repos');
    fs.unlinkSync(tmp);
  });
});
