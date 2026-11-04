import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Fresh database with all migrations + dev seed for the worker integration suite. */
export default function setup() {
  const root = join(import.meta.dirname, '../../..');
  const out = execFileSync('bash', [join(root, 'scripts/test-db.sh'), '--migrate-only'], {
    env: { ...process.env, PGTEST_DB: 'loopfield_worker_test' },
    encoding: 'utf8'
  });
  const url = out.trim().split('\n').pop()!;
  execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(root, 'supabase/seed.sql')], { stdio: 'ignore' });
  process.env.WORKER_TEST_DB_URL = url;
}
