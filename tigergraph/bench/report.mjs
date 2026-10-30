#!/usr/bin/env node
// Re-render the results table inside bench/README.md from results.json
// (between the BENCH:START / BENCH:END markers). Only real runs are in results.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BENCH_DIR, markdown } from './lib.mjs';

const rp = resolve(BENCH_DIR, 'results.json');
if (!existsSync(rp)) { console.error('no results.json yet: run a runner first'); process.exit(1); }
const all = JSON.parse(readFileSync(rp, 'utf8'));
const table = markdown(all);
const readme = resolve(BENCH_DIR, 'README.md');
const src = readFileSync(readme, 'utf8');
const out = src.replace(/<!-- BENCH:START -->[\s\S]*<!-- BENCH:END -->/, `<!-- BENCH:START -->\n${table}\n<!-- BENCH:END -->`);
writeFileSync(readme, out);
console.log(table);
