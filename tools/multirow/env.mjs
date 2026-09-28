// Load eformsign credentials from an env file given by EFORMSIGN_ENV_FILE (never hardcode values).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function loadEnv(file = process.env.EFORMSIGN_ENV_FILE) {
  if (!file) throw new Error('EFORMSIGN_ENV_FILE required');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
export async function core() {
  const dir = process.env.EFORMSIGN_CORE_DIR;
  if (!dir) throw new Error('EFORMSIGN_CORE_DIR required');
  return import(pathToFileURL(path.join(dir, 'dist', 'src', 'index.js')).href);
}
export async function client() {
  loadEnv();
  const m = await core();
  return new m.EformsignClient({
    apiKey: process.env.EFORMSIGN_API_KEY,
    privateKey: process.env.EFORMSIGN_PRIVATE_KEY,
    defaultMemberId: process.env.EFORMSIGN_MEMBER_ID,
    ...(process.env.EFORMSIGN_TOKEN_URL ? { tokenUrl: process.env.EFORMSIGN_TOKEN_URL } : {}),
  });
}
