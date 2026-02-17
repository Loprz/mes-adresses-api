#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROLE="${SERVICE_ROLE:-api}"
RUN_DB_MIGRATIONS="${RUN_DB_MIGRATIONS:-0}"
DB_MIGRATION_MAX_ATTEMPTS="${DB_MIGRATION_MAX_ATTEMPTS:-5}"
DB_MIGRATION_DELAY_SECONDS="${DB_MIGRATION_DELAY_SECONDS:-5}"

run_migrations() {
  local attempt=1

  while true; do
    if yarn typeorm:migration:run; then
      return 0
    fi

    if [ "${attempt}" -ge "${DB_MIGRATION_MAX_ATTEMPTS}" ]; then
      echo "Migration gate failed after ${attempt} attempt(s)." >&2
      return 1
    fi

    attempt=$((attempt + 1))
    echo "Migration attempt failed. Retrying in ${DB_MIGRATION_DELAY_SECONDS}s (${attempt}/${DB_MIGRATION_MAX_ATTEMPTS})..." >&2
    sleep "${DB_MIGRATION_DELAY_SECONDS}"
  done
}

case "${SERVICE_ROLE}" in
  api|cron)
    ;;
  *)
    echo "Unsupported SERVICE_ROLE='${SERVICE_ROLE}'. Use 'api' or 'cron'." >&2
    exit 1
    ;;
esac

if [ "${RUN_DB_MIGRATIONS}" = "1" ]; then
  echo "Running TypeORM migrations before boot (${SERVICE_ROLE})..."
  run_migrations
fi

if [ "${SERVICE_ROLE}" = "cron" ]; then
  exec node dist/apps/cron/main.js
fi

exec node dist/apps/api/main.js
