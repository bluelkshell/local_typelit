#!/bin/sh
# Copy the SQLite database into or out of the Docker volume.
#
#   ./docker-db.sh export backup.sqlite3   # safe while the app is running
#   ./docker-db.sh import db.sqlite3       # REPLACES the database in the volume
#
# Run it from this directory (next to docker-compose.yml).
set -eu

usage() {
    echo "Usage: $0 export <file> | import <file>" >&2
    exit 2
}

[ $# -eq 2 ] || usage
action="$1"
file="$2"

case "$action" in
export)
    if [ -e "$file" ]; then
        echo "Refusing to overwrite existing file: $file" >&2
        exit 1
    fi
    docker compose up -d web
    # SQLite's backup API gives a consistent copy even while the app is writing.
    docker compose exec -T web python -c "
import sqlite3
src = sqlite3.connect('/data/db.sqlite3')
dst = sqlite3.connect('/tmp/export.sqlite3')
src.backup(dst)
dst.close()
"
    docker compose cp web:/tmp/export.sqlite3 "$file"
    docker compose exec -T web rm -f /tmp/export.sqlite3
    echo "Saved a copy of the database to $file"
    ;;
import)
    [ -f "$file" ] || {
        echo "No such file: $file" >&2
        exit 1
    }
    printf 'This replaces the database inside the Docker volume with %s. Continue? [y/N] ' "$file"
    read -r answer
    [ "$answer" = "y" ] || [ "$answer" = "Y" ] || {
        echo "Cancelled."
        exit 1
    }

    # Work from a private copy with readable permissions, so the (unprivileged)
    # container user can read it whatever the original's mode is.
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    cp "$file" "$tmp/db.sqlite3"
    chmod 755 "$tmp"
    chmod 644 "$tmp/db.sqlite3"

    docker compose stop web
    docker compose run --rm --no-deps --entrypoint sh -v "$tmp:/import:ro" web \
        -c 'cp /import/db.sqlite3 /data/db.sqlite3 && rm -f /data/db.sqlite3-journal'
    docker compose up -d web
    echo "Imported $file. Migrations are applied automatically on start."
    ;;
*)
    usage
    ;;
esac
