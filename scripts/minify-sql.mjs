#!/usr/bin/env node
// Lexically safe SQL minifier used to push migrations through tools that take SQL inline
// (for example the Supabase MCP connector). It removes comments and collapses whitespace while
// preserving single-quoted strings, quoted identifiers and dollar-quoted bodies (whose code is
// minified recursively with the same rules). Output is verified by running the full pgTAP suite
// against the minified copies: MIGRATIONS_DIR=<out> bash scripts/test-db.sh
//
// usage: node scripts/minify-sql.mjs <inputDir> <outputDir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUNCT = new Set(['(', ')', ',', ';']);

export function minifySql(src) {
  let out = '';
  let i = 0;
  let pendingSpace = false;
  const emit = (s) => {
    if (pendingSpace && out.length) {
      const prev = out[out.length - 1];
      if (!PUNCT.has(prev) && !PUNCT.has(s[0])) out += ' ';
    }
    pendingSpace = false;
    out += s;
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '-' && n === '-') {
      while (i < src.length && src[i] !== '\n') i++;
      pendingSpace = true;
      continue;
    }
    if (c === '/' && n === '*') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; }
        else if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      pendingSpace = true;
      continue;
    }
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      pendingSpace = true;
      continue;
    }
    if (c === "'") {
      const escaped = !pendingSpace && /[eE]$/.test(out) && !/[A-Za-z0-9_][eE]$/.test(out);
      let j = i + 1;
      while (j < src.length) {
        if (escaped && src[j] === '\\') { j += 2; continue; }
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      emit(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j++;
      }
      emit(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      const prevIdent = /[A-Za-z0-9_]$/.test(out) && !pendingSpace;
      if (m && !prevIdent) {
        const tag = m[0];
        const end = src.indexOf(tag, i + tag.length);
        if (end < 0) throw new Error(`unterminated dollar quote ${tag}`);
        const body = src.slice(i + tag.length, end);
        emit(`${tag}${minifySql(body)}${tag}`);
        i = end + tag.length;
        continue;
      }
    }
    emit(c);
    i++;
  }
  return out.trim();
}

if (process.argv[1] && process.argv[1].endsWith('minify-sql.mjs')) {
  const [inDir, outDir] = process.argv.slice(2);
  if (!inDir || !outDir) {
    console.error('usage: node scripts/minify-sql.mjs <inputDir> <outputDir>');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  let before = 0;
  let after = 0;
  for (const f of readdirSync(inDir).filter((x) => x.endsWith('.sql')).sort()) {
    const src = readFileSync(join(inDir, f), 'utf8');
    const min = minifySql(src) + '\n';
    before += src.length;
    after += min.length;
    writeFileSync(join(outDir, f), min);
  }
  console.log(`minified ${before} -> ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller)`);
}
