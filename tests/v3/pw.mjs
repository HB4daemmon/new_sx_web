// Shared Playwright launcher for the V3 browser checks.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/tools/browser-tools/node_modules/playwright'].filter(Boolean);
let pw = null;
for (const candidate of candidates) {
  try { pw = require(candidate); break; } catch { /* try next */ }
}
if (!pw) throw new Error('Playwright not found: set PLAYWRIGHT_MODULE');
export const { chromium } = pw;

export async function launch() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  return chromium.launch({
    executablePath: executablePath && existsSync(executablePath) ? executablePath : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
}

export const BASE = process.env.BASE_URL || 'http://localhost:4173/';
