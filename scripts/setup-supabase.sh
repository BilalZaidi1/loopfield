#!/usr/bin/env bash
# Configure a hosted Supabase project (development or staging) from your own machine. Every step is idempotent and
# runs only when you name it; nothing targets a project unless SUPABASE_PROJECT_REF is set explicitly.
#
# Prerequisites: Supabase CLI 3.x (`supabase login` once, or SUPABASE_ACCESS_TOKEN), psql 15+ and Node 22.
# (CLI 2.x spells the remote target `--linked` instead of `--remote`.)
#
#   export SUPABASE_PROJECT_REF=<ref>                    # e.g. the loopfield-dev project
#   scripts/setup-supabase.sh link migrate seed secrets functions vault check
#
# Steps
#   link       supabase link: records the project for the CLI (no credentials are written by this script)
#   migrate    supabase db push --remote: lists the pending migrations and asks before applying them. Uses your
#              access token (database_write) or, if set, SUPABASE_DB_PASSWORD
#   seed       apply supabase/seed.sql (one labelled development region, no people or activity);
#              refuses when LOOPFIELD_ENV=production
#   secrets    supabase secrets set --env-file supabase/functions/.env (server-only values; see .env.example there)
#   functions  deploy every edge function. Each one verifies its own credentials (user session, webhook signature or
#              shared secret), so gateway JWT verification is off, matching supabase/config.toml
#   vault      create the job-runner URL and secret and the ticket-signing secret in Vault, generated inside the
#              database (existing entries are kept). Needs SUPABASE_DB_URL. Optional JOBS_RUNNER_SECRET /
#              TICKET_SIGNING_SECRET force specific values; psql reads them with \getenv, never from argv
#   types      regenerate apps/mobile/src/lib/database.types.ts from the linked project
#   check      migration status, scheduled jobs and the names (never values) of the Vault entries
#
# Not covered here (dashboard-only or provider-side; see docs/SETUP.md): the Auth Send Email hook, Auth URL settings,
# Resend domain verification, Stream and RevenueCat dashboards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${SUPABASE_PROJECT_REF:-}"
[[ $# -gt 0 ]] || { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
[[ -n "$REF" ]] || { echo "Set SUPABASE_PROJECT_REF to the project you mean to configure."; exit 2; }
command -v supabase >/dev/null || { echo "Supabase CLI not found: https://supabase.com/docs/guides/cli"; exit 2; }

need_db_url() {
  [[ -n "${SUPABASE_DB_URL:-}" ]] || { echo "Set SUPABASE_DB_URL (Project Settings > Database > connection string, session pooler)."; exit 2; }
  command -v psql >/dev/null || { echo "psql 15+ is required for this step."; exit 2; }
}

for step in "$@"; do
  echo "== $step ($REF)"
  case "$step" in
    link)
      supabase link --project-ref "$REF"
      ;;
    migrate)
      supabase db push --remote ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"}
      ;;
    seed)
      [[ "${LOOPFIELD_ENV:-}" != "production" ]] || { echo "Refusing to seed a production project."; exit 1; }
      need_db_url
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
      ;;
    secrets)
      [[ -f supabase/functions/.env ]] || { echo "Create supabase/functions/.env from supabase/functions/.env.example first."; exit 1; }
      supabase secrets set --env-file supabase/functions/.env
      ;;
    functions)
      # All functions; --use-api bundles on Supabase's side, so Docker is not required locally.
      supabase functions deploy --no-verify-jwt ${FUNCTIONS_DEPLOY_FLAGS:---use-api}
      ;;
    vault)
      # Server secrets live in Vault and are generated inside the database, so nobody copies them around:
      #   jobs_runner_url / jobs_runner_secret  pg_cron -> jobs function trigger (the function reads the same entry)
      #   ticket_signing_secret                 signs competitive session tickets
      # Existing entries are kept. Set JOBS_RUNNER_SECRET or TICKET_SIGNING_SECRET only to force a specific value.
      need_db_url
      export JOBS_RUNNER_URL="https://$REF.supabase.co/functions/v1/jobs"
      export JOBS_RUNNER_SECRET="${JOBS_RUNNER_SECRET:-}" TICKET_SIGNING_SECRET="${TICKET_SIGNING_SECRET:-}"
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv runner_url JOBS_RUNNER_URL
\getenv runner_secret JOBS_RUNNER_SECRET
\getenv ticket_secret TICKET_SIGNING_SECRET
\o /dev/null
select vault.update_secret(id, :'runner_url') from vault.secrets where name = 'jobs_runner_url';
select vault.create_secret(:'runner_url', 'jobs_runner_url', 'Loopfield jobs edge function URL')
 where not exists (select 1 from vault.secrets where name = 'jobs_runner_url');
select vault.update_secret(id, :'runner_secret') from vault.secrets where name = 'jobs_runner_secret' and :'runner_secret' <> '';
select vault.create_secret(coalesce(nullif(:'runner_secret', ''), encode(extensions.gen_random_bytes(32), 'hex')), 'jobs_runner_secret', 'Shared secret sent as x-jobs-secret')
 where not exists (select 1 from vault.secrets where name = 'jobs_runner_secret');
select vault.update_secret(id, :'ticket_secret') from vault.secrets where name = 'ticket_signing_secret' and :'ticket_secret' <> '';
select vault.create_secret(coalesce(nullif(:'ticket_secret', ''), encode(extensions.gen_random_bytes(48), 'base64')), 'ticket_signing_secret', 'Signs competitive session tickets')
 where not exists (select 1 from vault.secrets where name = 'ticket_signing_secret');
SQL
      echo "vault entries jobs_runner_url, jobs_runner_secret and ticket_signing_secret are present"
      ;;
    types)
      bash scripts/gen-types.sh --remote
      ;;
    check)
      supabase migration list --remote
      if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
        psql "$SUPABASE_DB_URL" -X -q -c "select jobname, schedule from cron.job where jobname like 'loopfield-%' order by 1" \
          -c "select name from vault.secrets where name in ('jobs_runner_url', 'jobs_runner_secret', 'ticket_signing_secret') order by 1"
      else
        echo "(set SUPABASE_DB_URL to also list cron jobs and Vault entry names)"
      fi
      ;;
    *)
      echo "Unknown step: $step"; exit 2
      ;;
  esac
done
