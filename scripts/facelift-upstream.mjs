#!/usr/bin/env node
// Manually pick which FaceLift upstream the app uses, by setting FACELIFT_UPSTREAM
// in .env.local. Overrides the automatic OSCAR-up health check in src/lib/facelift.ts.
//
//   npm run facelift            # show current setting + configured URLs
//   npm run facelift auto       # health-check OSCAR, fall back to Modal (default)
//   npm run facelift oscar      # always use OSCAR_FACELIFT_URL
//   npm run facelift modal      # always use FACELIFT_URL (Modal)
//
// Note: Next.js reads .env.local at startup, so restart `npm run dev` to apply.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
const KEY = 'FACELIFT_UPSTREAM';
const VALID = ['auto', 'oscar', 'modal'];

function readEnv() {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
}

function getValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

const arg = (process.argv[2] ?? '').toLowerCase();
const text = readEnv();

if (!arg) {
  const current = getValue(text, KEY) ?? 'auto (unset)';
  console.log(`FACELIFT_UPSTREAM = ${current}`);
  console.log(`  OSCAR_FACELIFT_URL = ${getValue(text, 'OSCAR_FACELIFT_URL') ?? '(not set)'}`);
  console.log(`  FACELIFT_URL       = ${getValue(text, 'FACELIFT_URL') ?? '(not set)'}`);
  process.exit(0);
}

if (!VALID.includes(arg)) {
  console.error(`Invalid upstream "${arg}". Use one of: ${VALID.join(', ')}`);
  process.exit(1);
}

const line = `${KEY}=${arg}`;
const updated = new RegExp(`^${KEY}=.*$`, 'm').test(text)
  ? text.replace(new RegExp(`^${KEY}=.*$`, 'm'), line)
  : (text.endsWith('\n') || text === '' ? text : text + '\n') + line + '\n';

writeFileSync(ENV_PATH, updated);
console.log(`Set ${line}`);
console.log('Restart `npm run dev` for the change to take effect.');
