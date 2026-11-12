#!/usr/bin/env node
// Replaces the GitHub owner "vanepoint-hq" in every text file of the repo.
//
//   node tools/set-owner.mjs your-github-name            (preview: lists files, changes nothing)
//   node tools/set-owner.mjs your-github-name --apply    (makes the changes)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [owner, flag] = process.argv.slice(2);
const OLD = 'vanepoint-hq';

if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
  console.error('Usage: node tools/set-owner.mjs <github-user-or-org> [--apply]');
  process.exit(2);
}

const SKIP = new Set(['node_modules', 'target', '.git', 'dist', '.expo']);
const TEXT = new Set(['.md', '.json', '.yml', '.yaml', '.toml', '.cff', '.ts', '.tsx', '.js', '.mjs', '.rs', '.py', '.html', '.txt', '']);

const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.has(extname(name)) && !name.endsWith('-lock.json') && name !== 'Cargo.lock' && name !== 'set-owner.mjs') {
      const s = readFileSync(p, 'utf8');
      if (s.includes(OLD)) hits.push([p, s]);
    }
  }
})(root);

for (const [p, s] of hits) {
  const n = s.split(OLD).length - 1;
  console.log(`${flag === '--apply' ? 'updated' : 'would update'}  ${relative(root, p)}  (${n})`);
  if (flag === '--apply') writeFileSync(p, s.replaceAll(OLD, owner));
}
console.log(`\n${hits.length} files ${flag === '--apply' ? 'updated' : 'would change'}. ${flag === '--apply' ? '' : 'Run again with --apply to make the changes.'}`);
if (flag === '--apply') {
  console.log('Also: run "python assets/src/make_assets.py" to refresh the social preview image (it shows the URL).');
}
