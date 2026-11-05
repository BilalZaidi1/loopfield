#!/usr/bin/env bash
# Apply all migrations to a disposable PostgreSQL + PostGIS database and run the SQL test suite.
#   PGTEST_URL=postgres://user:pass@host:port/postgres  -> use an existing server (CI service container)
#   otherwise a throwaway local cluster is started with the PostgreSQL 16 binaries.
#   --migrate-only  apply migrations, print the database URL and stop (no seed, no tests)
#   --server-only   start the server if needed and print its base URL (no database is created)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"
DB="${PGTEST_DB:-loopfield_test}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGTEST_PORT:-54329}"
RUNAS=()
if [[ -z "${PGTEST_URL:-}" ]]; then
  DATA="${PGTEST_DATA:-${TMPDIR:-/tmp}/loopfield-pg}"
  if [[ $(id -u) -eq 0 ]]; then RUNAS=(runuser -u postgres --); fi
  if [[ ! -f "$DATA/PG_VERSION" ]]; then
    mkdir -p "$DATA"; [[ $(id -u) -eq 0 ]] && chown postgres "$DATA"
    "${RUNAS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
  fi
  if ! "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -l "$DATA/server.log" -w start >/dev/null
  fi
  BASE="postgresql://postgres@localhost:$PORT"
else
  BASE="${PGTEST_URL%/*}"
fi
if [[ "${1:-}" == "--server-only" ]]; then echo "$BASE"; exit 0; fi
ADMIN="$BASE/postgres"
URL="$BASE/$DB"
psql -q "$ADMIN" -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
psql -q "$URL" -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
run() { psql -q "$URL" -v ON_ERROR_STOP=1 -X -f "$1" >/dev/null 2> >(grep -v "^NOTICE" >&2) || { echo "FAILED: $1"; exit 1; }; }
run "$ROOT/supabase/tests/shim/supabase_shim.sql"
for f in "$MIG_DIR"/*.sql; do run "$f"; done
echo "migrations applied: $(ls "$MIG_DIR"/*.sql | wc -l) from $MIG_DIR"
if [[ "${1:-}" == "--migrate-only" ]]; then echo "$URL"; exit 0; fi
run "$ROOT/supabase/seed.sql"
psql -q "$URL" -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap with schema extensions" >/dev/null
fail=0
for t in "$ROOT"/supabase/tests/sql/*.sql; do
  out=$(psql "$URL" -X -v ON_ERROR_STOP=1 -t -A -f "$t" 2>&1) || { echo "ERROR in $(basename "$t")"; echo "$out" | tail -20; fail=1; continue; }
  if echo "$out" | grep -qE "^not ok|Looks like you failed"; then echo "FAIL $(basename "$t")"; echo "$out" | grep -E "^not ok|#" | head -40; fail=1;
  else echo "ok   $(basename "$t") ($(echo "$out" | grep -cE '^ok') assertions)"; fi
done
exit $fail
