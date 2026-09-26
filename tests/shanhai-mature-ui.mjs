import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = process.env.SHANHAI_UI_REPORT_DIR
  ? path.resolve(process.env.SHANHAI_UI_REPORT_DIR)
  : await mkdtemp(path.join(os.tmpdir(), 'shanhai-mature-ui-'));
const suites = [
  {
    name: 'classic-ui',
    script: 'tests/shanhai-classic-ui.mjs',
    reportEnv: 'SHANHAI_CLASSIC_UI_REPORT_DIR',
  },
  {
    name: 'compact-browser',
    script: 'tests/shanhai-compact-browser.mjs',
    reportEnv: 'SHANHAI_COMPACT_BROWSER_REPORT_DIR',
  },
  {
    name: 'restart',
    script: 'tests/shanhai-restart-browser.mjs',
    reportEnv: 'SHANHAI_RESTART_REPORT_DIR',
  },
];
const results = [];

await mkdir(reportDir, { recursive: true });
for (const suite of suites) {
  const suiteReportDir = path.join(reportDir, suite.name);
  const result = spawnSync(process.execPath, [suite.script], {
    cwd: root,
    env: { ...process.env, [suite.reportEnv]: suiteReportDir },
    stdio: 'inherit',
  });
  results.push({
    name: suite.name,
    reportDir: suiteReportDir,
    status: result.status,
    signal: result.signal,
    error: result.error?.message || null,
  });
}

await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
  url: process.env.BROWSER_URL || 'http://localhost:4173/',
  reportDir,
  generatedAt: new Date().toISOString(),
  viewports: [
    { width: 320, height: 760 },
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ],
  suites: results,
}, null, 2) + '\n');

const failed = results.filter(result => result.status !== 0 || result.error);
if (failed.length) {
  console.error(`Mature UI browser failures: ${JSON.stringify(failed)}`);
  process.exitCode = 1;
} else {
  console.log(`Mature UI report: ${reportDir}`);
}
