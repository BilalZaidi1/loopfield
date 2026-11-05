#!/usr/bin/env node
// The over-the-air update workflows bundle the app with their own env block. The pilot update must match the
// `pilot` build profile exactly, or updates would ship different configuration (or a different fingerprint)
// than the build. The Expo Go preview uses the same values plus EXPO_GO_UPDATE=1 and nothing else.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/mobile');
const profile = JSON.parse(readFileSync(join(app, 'eas.json'), 'utf8')).build.pilot.env;
const workflowEnv = (file) => {
  const yaml = readFileSync(join(app, '.eas/workflows', file), 'utf8');
  return Object.fromEntries([...yaml.matchAll(/^ {6}([A-Z0-9_]+): "([^"]*)"$/gm)].map((m) => [m[1], m[2]]));
};
const differences = (expected, actual) => [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((k) => expected[k] !== actual[k]);

const failures = [
  ['publish-pilot-update.yml', profile],
  ['publish-expo-go-update.yml', { ...profile, EXPO_GO_UPDATE: '1' }]
]
  .map(([file, expected]) => [file, differences(expected, workflowEnv(file))])
  .filter(([, keys]) => keys.length);
for (const [file, keys] of failures) console.error(`env in ${file} differs from the pilot build profile: ${keys.join(', ')}`);
if (failures.length) process.exit(1);
console.log(`update workflow env in sync with the pilot profile (${Object.keys(profile).length} variables)`);
