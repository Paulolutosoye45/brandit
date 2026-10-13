#!/usr/bin/env bash
# Backs up the database and the artwork files into ./backups, and keeps the last 14.
# Docker Compose server:   ./scripts/backup.sh
# Run it every night:      0 2 * * *  cd /path/to/brandit && ./scripts/backup.sh
set -euo pipefail
mkdir -p backups
stamp=$(date +%Y-%m-%d_%H%M)
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" | gzip > "backups/brandit-db-$stamp.sql.gz"
else
  docker compose exec -T db pg_dump -U brandit brandit | gzip > "backups/brandit-db-$stamp.sql.gz"
  docker compose cp app:/app/.data/uploads - | gzip > "backups/brandit-files-$stamp.tar.gz" || true
fi
ls -1t backups/brandit-db-* 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/brandit-files-* 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Backed up to backups/ ($stamp). Copy the folder somewhere off this server."
