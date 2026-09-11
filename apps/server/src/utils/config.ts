import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CommandsSchema = z.object({
  test: z.string().optional(),
  build: z.string().optional(),
  lint: z.string().optional(),
  dev: z.string().optional(),
}).optional();

const ConfigSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().default(4173),
  }).default({}),
  repos: z.object({
    directory: z.string().default(''),
  }).default({}),
  agent: z.object({
    provider: z.string().default('claude-code'),
    permission_mode: z.string().default('dangerously-skip-permissions'),
  }).default({}),
  prompts: z.object({
    task_wrapper: z.string().default('./prompts/task.md'),
    manager: z.string().default('./prompts/manager.md'),
    general: z.string().default('./prompts/general.md'),
  }).default({}),
  voice: z.object({
    enabled: z.boolean().default(true),
    provider: z.string().default('browser'),
  }).default({}),
  git: z.object({
    branch_strategy: z.string().default('feature'),
    branch_prefixes: z.object({
      feature: z.string().default('feature/'),
      bugfix: z.string().default('fix/'),
      refactor: z.string().default('refactor/'),
    }).default({}),
    commits: z.object({
      enabled: z.boolean().default(true),
      style: z.string().default('short'),
      max_subject_length: z.number().default(50),
      conventional_commits: z.boolean().default(false),
      ai_attribution: z.boolean().default(false),
    }).default({}),
    approval: z.object({
      merge_to_main: z.boolean().default(true),
      push_main: z.boolean().default(true),
    }).default({}),
  }).default({}),
  vercel: z.object({
    enabled: z.boolean().default(false),
  }).default({}),
  notifications: z.object({
    enabled: z.boolean().default(true),
  }).default({}),
  commands: CommandsSchema,
  data_dir: z.string().default('./data'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

// Resolve from __dirname so it works regardless of CWD (npm workspace runs from apps/server)
const MONOREPO_CONFIG = path.resolve(__dirname, '../../../../config/default.yml');

let config: AppConfig | null = null;
let configPath = '';

export function loadConfig(cfgPath?: string): AppConfig {
  const resolvedPath = cfgPath ?? MONOREPO_CONFIG;
  configPath = resolvedPath;

  let raw: Record<string, unknown> = {};
  if (fs.existsSync(resolvedPath)) {
    raw = (yaml.load(fs.readFileSync(resolvedPath, 'utf8')) as Record<string, unknown>) ?? {};
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error('Config validation error:', result.error.format());
    throw new Error('Invalid configuration file');
  }

  config = result.data;
  console.debug(`[config] loaded from ${resolvedPath} — repos.directory=${result.data.repos.directory || '(empty)'}`);

  // Allow env overrides
  if (process.env.REPOS_DIRECTORY) config.repos.directory = process.env.REPOS_DIRECTORY;
  if (process.env.SERVER_PORT) config.server.port = parseInt(process.env.SERVER_PORT, 10);
  if (process.env.SERVER_HOST) config.server.host = process.env.SERVER_HOST;

  // Resolve repos.directory relative to cwd if not absolute
  if (config.repos.directory && !path.isAbsolute(config.repos.directory)) {
    config.repos.directory = path.resolve(process.cwd(), config.repos.directory);
  }

  return config;
}

export function getConfig(): AppConfig {
  if (!config) return loadConfig();
  return config;
}

export function reloadConfig(): AppConfig {
  config = null;
  return loadConfig(configPath || undefined);
}

export interface RepoConfig {
  commands?: {
    test?: string;
    build?: string;
    lint?: string;
    dev?: string;
  };
  agent?: {
    instructions?: string;
  };
  preview?: {
    type?: string;
    url?: string;
  };
}

export function loadRepoConfig(repoPath: string): RepoConfig {
  const candidates = ['.devagent.yml', '.claudectrl.yml', '.devagent.yaml', '.claudectrl.yaml'];
  for (const name of candidates) {
    const p = path.join(repoPath, name);
    if (fs.existsSync(p)) {
      try {
        return (yaml.load(fs.readFileSync(p, 'utf8')) as RepoConfig) ?? {};
      } catch {
        return {};
      }
    }
  }
  return {};
}
