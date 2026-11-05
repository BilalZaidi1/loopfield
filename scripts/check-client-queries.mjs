#!/usr/bin/env node
// Static check of the mobile app's database calls against the generated schema types
// (apps/mobile/src/lib/database.types.ts, produced by scripts/gen-types.sh from supabase/migrations):
//   1. every `.from('<table>')…select('<columns>')` names real tables, columns and embedded relations;
//   2. every `rpc('<fn>', { … })` call passes only argument names the SQL function declares and includes
//      every argument that has no SQL default — checked by compiling a generated file with tsc.
// supabase-js reports wrong select columns only as result types (no compile error) and the app's rpc()
// wrapper takes loosely typed args, so without this check such mistakes would surface only at runtime.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/mobile');
const typesFile = join(app, 'src/lib/database.types.ts');
const types = readFileSync(typesFile, 'utf8');

// ---- schema model from the generated types ---------------------------------------------------
const relations = new Map();
for (const section of ['Tables', 'Views']) {
  const block = new RegExp(`\\n    ${section}: \\{\\n([\\s\\S]*?)\\n    \\}\\n`).exec(types)?.[1] ?? '';
  for (const m of ('\n' + block).matchAll(/\n {6}([a-z_0-9]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
    relations.set(m[1], new Set([...m[2].matchAll(/^ {10}([a-z_0-9]+)\??:/gm)].map((c) => c[1])));
  }
}
const foreignKeys = new Set([...types.matchAll(/foreignKeyName: "([^"]+)"/g)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) && p !== typesFile ? [p] : [];
  });
}
const files = [...walk(join(app, 'app')), ...walk(join(app, 'src'))];
const problems = [];

// ---- 1. select strings ---------------------------------------------------------------------------
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function checkSelect(table, select, where) {
  const cols = relations.get(table);
  if (!cols) return void problems.push(`${where}: unknown table or view "${table}"`);
  for (const item of splitTop(select.replace(/\s+/g, ' '))) {
    if (!item || item === '*') continue;
    const embed = /^(?:([a-z_0-9]+):)?([a-z_0-9]+)(?:!([a-z_0-9]+))?(?:!inner|!left)?\((.*)\)$/s.exec(item);
    if (embed) {
      const [, , rel, hint, inner] = embed;
      if (hint && !foreignKeys.has(hint) && !relations.has(hint)) problems.push(`${where}: unknown relationship hint "${hint}"`);
      if (!relations.has(rel)) problems.push(`${where}: unknown embedded relation "${rel}"`);
      else checkSelect(rel, inner, `${where} > ${rel}`);
      continue;
    }
    const col = /^(?:[a-z_0-9]+:)?([a-z_0-9]+)(?:->>?[a-z_0-9'"]+)*(?:::[a-z0-9_]+)?$/.exec(item);
    if (!col) problems.push(`${where}: cannot parse select item "${item}"`);
    else if (!cols.has(col[1])) problems.push(`${where}: column "${col[1]}" does not exist on ${table}`);
  }
}
let selects = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of src.matchAll(/\.from\('([a-z_0-9]+)'\)((?:\s*\.[a-zA-Z]+\([^;]*?\))*?)\s*\.select\(\s*'([^']*)'/gs)) {
    selects++;
    checkSelect(m[1], m[3], `${rel}:${src.slice(0, m.index).split('\n').length}`);
  }
  for (const m of src.matchAll(/(?<!storage)\.from\('([a-z_0-9]+)'\)/g)) {
    if (!relations.has(m[1]) && !/storage\s*\.\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) {
      problems.push(`${rel}: unknown table or view "${m[1]}"`);
    }
  }
}

// ---- 2. rpc argument names (compiled) -----------------------------------------------------------
function objectKeys(src, start) {
  // src[start] === '{' — returns the top-level keys, or null when the object is not a plain literal.
  let depth = 0, expectKey = true;
  const keys = [];
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') {
      for (j++; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++;
      continue;
    }
    if ('{[('.includes(c)) {
      depth++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if ('}])'.includes(c)) {
      if (--depth === 0) return keys;
      continue;
    }
    if (depth !== 1) continue;
    if (c === ',') expectKey = true;
    else if (expectKey && !/\s/.test(c)) {
      const k = /^(?:(\.\.\.)|([A-Za-z_$][\w$]*)\s*(?=[:,}]|$))/.exec(src.slice(j));
      if (!k || k[1]) return null;
      keys.push(k[2]);
      expectKey = false;
    }
  }
  return null;
}
const checks = [];
let rpcs = 0, skipped = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of src.matchAll(/\brpc(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*'([a-z_0-9]+)'\s*/g)) {
    rpcs++;
    const where = `${rel}:${src.slice(0, m.index).split('\n').length}`;
    let k = m.index + m[0].length;
    let keys = null;
    if (src[k] === ')') keys = [];
    else if (src[k] === ',') {
      for (k++; /\s/.test(src[k]); k++);
      keys = src[k] === '{' ? objectKeys(src, k) : src[k] === ')' ? [] : null;
    }
    if (!keys) { skipped++; checks.push(`// not checked (arguments are not a plain object literal): ${where}`); continue; }
    checks.push(`check('${m[1]}', { ${keys.map((x) => `${x}: v`).join(', ')} }); // ${where}`);
  }
}
const outDir = join(app, '.query-check');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'rpc-args.check.ts'), `// GENERATED by scripts/check-client-queries.mjs — do not edit.
import type { Database } from '../src/lib/database.types';
type F = Database['public']['Functions'];
type Arg = { readonly __arg: unique symbol };
type KeysOf<A> = string extends keyof A ? Record<string, never> : { [K in keyof A]: Arg };
type ArgsOf<N extends keyof F> = F[N] extends { Args: infer A } ? KeysOf<A> : never;
declare const v: Arg;
declare function check<N extends keyof F>(name: N, args: ArgsOf<N>): void;
${checks.join('\n')}
`);
writeFileSync(join(outDir, 'tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', include: ['rpc-args.check.ts'] }, null, 2));
try {
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['--noEmit', '-p', join(outDir, 'tsconfig.json')], { stdio: 'pipe' });
} catch (err) {
  const out = String(err.stdout ?? '') + String(err.stderr ?? '');
  const lines = readFileSync(join(outDir, 'rpc-args.check.ts'), 'utf8').split('\n');
  for (const m of out.matchAll(/rpc-args\.check\.ts\((\d+),\d+\): error TS\d+: ([^\n]+)/g)) {
    problems.push(`${lines[Number(m[1]) - 1]?.split('// ')[1] ?? 'rpc'}: ${m[2]}`);
  }
  if (!problems.length) problems.push(out.trim() || 'tsc failed');
}

console.log(`checked ${selects} select strings and ${rpcs - skipped}/${rpcs} rpc calls against ${relations.size} tables/views`);
if (skipped) console.log(`${skipped} rpc call(s) pass non-literal arguments and are covered only by the SQL tests`);
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('no mismatches');
