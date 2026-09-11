#!/usr/bin/env node
/**
 * Install/remove Windows autostart via Task Scheduler
 * Usage:
 *   node scripts/install-autostart.mjs install
 *   node scripts/install-autostart.mjs remove
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TASK_NAME = 'ClaudeCTRL';

const action = process.argv[2] ?? 'install';

if (action === 'install') {
  const nodePath = process.execPath.replace(/\//g, '\\');
  const rootWin = ROOT.replace(/\//g, '\\');
  const tsxPath = path.join(ROOT, 'node_modules', '.bin', 'tsx.cmd').replace(/\//g, '\\');

  const scriptPath = path.join(ROOT, 'scripts', 'start-server.cmd').replace(/\//g, '\\');
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'start-server.cmd'),
    `@echo off\ncd /d "${rootWin}"\n"${tsxPath}" apps/server/src/index.ts\n`
  );

  const vbsPath = path.join(ROOT, 'scripts', 'start-hidden.vbs').replace(/\//g, '\\');
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'start-hidden.vbs'),
    `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${scriptPath}""", 0, False\n`
  );

  const xmlPath = path.join(ROOT, 'scripts', 'claudectrl-task.xml').replace(/\//g, '\\');
  const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ClaudeCTRL - Local developer cockpit for Claude Code</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${vbsPath}"</Arguments>
      <WorkingDirectory>${rootWin}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
  fs.writeFileSync(path.join(ROOT, 'scripts', 'claudectrl-task.xml'), taskXml);

  try {
    execSync(`schtasks /Create /TN "${TASK_NAME}" /XML "${xmlPath}" /F`);
    console.log('✓ Autostart installed. ClaudeCTRL will start on next login.');
  } catch (e) {
    console.error('Failed:', e.message);
    console.log(`Manual install: schtasks /Create /TN "${TASK_NAME}" /XML "${xmlPath}" /F`);
  }
} else if (action === 'remove') {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`);
    console.log('✓ Autostart removed.');
  } catch {
    console.log('Task not found or already removed.');
  }
} else {
  console.log('Usage: node scripts/install-autostart.mjs [install|remove]');
}
