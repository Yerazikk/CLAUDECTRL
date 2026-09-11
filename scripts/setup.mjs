#!/usr/bin/env node
/**
 * ClaudeCTRL setup script
 * Run: npm run setup
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function log(msg) { console.log(`  ${msg}`); }
function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m⚠\x1b[0m ${msg}`); }
function err(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function header(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

function checkCli(cmd, name) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    ok(`${name} available`);
    return true;
  } catch {
    err(`${name} not found or not authenticated`);
    return false;
  }
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n\x1b[1mClaudeCTRL Setup\x1b[0m\n');

  // 1. Check prerequisites
  header('Checking prerequisites...');
  const hasNode = checkCli('node --version', 'Node.js');
  const hasClaude = checkCli('claude --version', 'Claude CLI');
  const hasGit = checkCli('git --version', 'Git');
  const hasGh = checkCli('gh auth status', 'GitHub CLI (authenticated)');

  if (!hasClaude) {
    warn('Install Claude Code: https://docs.anthropic.com/en/docs/claude-code');
    warn('Then run: claude  (to authenticate)');
  }
  if (!hasGh) {
    warn('Install GitHub CLI: https://cli.github.com/');
    warn('Then run: gh auth login');
  }

  // 2. Create config if missing
  header('Configuration...');
  const configPath = path.join(ROOT, 'config', 'default.yml');
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
    err('Config file missing - this should have been created already');
  } else {
    ok('Config file exists');
  }

  // Check repos directory
  let configContent = fs.readFileSync(configPath, 'utf8');
  const hasReposDir = !configContent.includes('directory: ""');

  if (!hasReposDir) {
    const reposDir = await ask('  Enter your GitHub/repos directory path (e.g. C:/Users/me/GitHub): ');
    if (reposDir) {
      configContent = configContent.replace('directory: ""', `directory: "${reposDir.replace(/\\/g, '/')}"`);
      fs.writeFileSync(configPath, configContent);
      ok(`Repos directory set to: ${reposDir}`);
    }
  } else {
    ok('Repos directory configured');
  }

  // 3. Create data directory
  header('Initializing data directory...');
  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  ok(`Data directory: ${dataDir}`);

  // Create .gitignore for data
  const dataGitignore = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(dataGitignore)) {
    fs.writeFileSync(dataGitignore, '*\n!.gitignore\n');
  }

  // 4. Build if needed
  header('Building...');
  try {
    log('Installing dependencies...');
    execSync('npm install', { cwd: ROOT, stdio: 'pipe' });
    ok('Dependencies installed');

    log('Building shared package...');
    execSync('npm run build --workspace=packages/shared', { cwd: ROOT, stdio: 'pipe' });
    ok('Shared package built');
  } catch (e) {
    err(`Build failed: ${e.message}`);
  }

  // 5. Windows autostart
  header('Windows autostart...');
  const autoStartAnswer = await ask('  Install Windows autostart (Task Scheduler)? [y/N]: ');
  if (autoStartAnswer.toLowerCase() === 'y') {
    await installWindowsAutostart();
  } else {
    log('Skipped. Run scripts/install-autostart.mjs later to install.');
  }

  // 6. Summary
  header('Setup complete!\n');
  log('Start development mode:  npm run dev');
  log('Start server only:       npm run dev:server');
  log('Run tests:               npm test');
  log('');
  log('Open in browser:  http://localhost:4173');
  log('');
  if (!hasClaude || !hasGh) {
    warn('Some CLI tools are missing. See above for setup instructions.');
  }
}

async function installWindowsAutostart() {
  const scriptPath = path.join(ROOT, 'scripts', 'start-server.cmd').replace(/\//g, '\\');
  const nodePath = process.execPath.replace(/\//g, '\\');
  const rootWin = ROOT.replace(/\//g, '\\');

  // Create a start script
  const startScript = `@echo off
cd /d "${rootWin}"
"${nodePath}" --loader tsx/esm apps/server/src/index.ts
`;
  fs.writeFileSync(path.join(ROOT, 'scripts', 'start-server.cmd'), startScript);

  // Create VBScript wrapper to run without window
  const vbsPath = path.join(ROOT, 'scripts', 'start-hidden.vbs').replace(/\//g, '\\');
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${scriptPath}""", 0, False
`;
  fs.writeFileSync(path.join(ROOT, 'scripts', 'start-hidden.vbs'), vbsContent);

  // Create Task Scheduler XML
  const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ClaudeCTRL - Local developer cockpit for Claude Code</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${vbsPath}"</Arguments>
      <WorkingDirectory>${rootWin}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

  const xmlPath = path.join(ROOT, 'scripts', 'claudectrl-task.xml');
  fs.writeFileSync(xmlPath, taskXml);

  try {
    execSync(`schtasks /Create /TN "ClaudeCTRL" /XML "${xmlPath}" /F`, { stdio: 'pipe' });
    ok('Windows autostart installed (Task Scheduler: ClaudeCTRL)');
    log('Will start automatically on next Windows login.');
  } catch (e) {
    err(`Failed to install Task Scheduler task: ${e.message}`);
    warn(`You can install manually: schtasks /Create /TN "ClaudeCTRL" /XML "${xmlPath}" /F`);
  }
}

main().catch((e) => {
  console.error('Setup failed:', e);
  process.exit(1);
});
