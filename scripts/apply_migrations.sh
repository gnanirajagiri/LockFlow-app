#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# LockFlow — apply pending SQL migrations to a Supabase Postgres database.
#
# Applies supabase/migrations/*.sql in filename order, one transaction per
# migration, recording history in supabase_migrations.schema_migrations — the
# SAME tracking table the Supabase platform uses — so this script and the
# Supabase CLI agree on what is applied. Re-runs are no-ops. Each migration is
# atomic: a failure aborts the transaction and leaves nothing half-applied.
#
# Usage:
#   ./scripts/apply_migrations.sh "<connection-string>"
#   (or export DATABASE_URL and run without arguments)
#
# Use the session pooler connection string (Supabase → Connect → Session
# pooler); it is IPv4-compatible and allows transactions.
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

CONN="${1:-${DATABASE_URL:-}}"
if [ -z "$CONN" ]; then
  echo "Usage: $0 \"postgresql://...\"   (or export DATABASE_URL)" >&2
  exit 1
fi
export PGCONNECT_TIMEOUT=15

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase/migrations" && pwd)"

PSQL=(psql "$CONN" -X -q -v ON_ERROR_STOP=1)

# Connectivity + history table bootstrap (idempotent).
if ! "${PSQL[@]}" -Atc "select 1;" >/dev/null 2>&1; then
  echo "Could not connect to the database with the provided connection string." >&2
  exit 1
fi

"${PSQL[@]}" \
  -c "create schema if not exists supabase_migrations;" \
  -c "create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements int default 0,
        name text unique
      );"

for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  version="$(basename "$file" .sql | sed 's/_.*//')"   # leading timestamp

  applied=$("${PSQL[@]}" -Atc "select count(*) from supabase_migrations.schema_migrations where name = '$name';")

  if [ "$applied" -gt 0 ]; then
    echo "  = $name (already applied)"
    continue
  fi

  echo "  → applying $name …"
  # One psql session, one transaction: begin → file → history row → commit.
  # ON_ERROR_STOP aborts the session on any failure, rolling everything back.
  "${PSQL[@]}" \
    -c "begin;" \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');" \
    -c "commit;" \
    >/dev/null
  echo "    ✓ $name"
done

echo "All migrations applied."
