#!/usr/bin/env node
// The over-the-air update workflow bundles the app with its own env block; it must match the `pilot` build
// profile exactly, or updates would ship different configuration (or a different fingerprint) than the build.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/mobile');
const profile = JSON.parse(readFileSync(join(app, 'eas.json'), 'utf8')).build.pilot.env;
const yaml = readFileSync(join(app, '.eas/workflows/publish-pilot-update.yml'), 'utf8');
const workflowEnv = Object.fromEntries([...yaml.matchAll(/^ {6}([A-Z0-9_]+): "([^"]*)"$/gm)].map((m) => [m[1], m[2]]));
const problems = [...new Set([...Object.keys(profile), ...Object.keys(workflowEnv)])].filter((k) => profile[k] !== workflowEnv[k]);
if (problems.length) {
  console.error(`pilot env differs between eas.json and publish-pilot-update.yml: ${problems.join(', ')}`);
  process.exit(1);
}
console.log(`pilot env in sync (${Object.keys(profile).length} variables)`);
