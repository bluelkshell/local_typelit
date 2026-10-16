#!/bin/sh
# Bring the database up to date, then start the server (or whatever command was given).
set -e

python manage.py migrate --noinput

exec "$@"
