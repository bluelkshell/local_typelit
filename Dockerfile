# syntax=docker/dockerfile:1
# Local TypeLit: Django app served by gunicorn, static files by WhiteNoise.
ARG PYTHON_IMAGE=python:3.14-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Run as an unprivileged user.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd --gid "${APP_GID}" app \
 && useradd --uid "${APP_UID}" --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Production defaults. The database and the generated secret key live in /data,
# which is a volume so they survive rebuilds.
ENV DJANGO_DEBUG=0 \
    DJANGO_DATA_DIR=/data
RUN mkdir -p /data \
 && chown app:app /data \
 && DJANGO_SECRET_KEY=build-time-only python manage.py collectstatic --noinput
VOLUME /data

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4)"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
# One worker with several threads: it is a single-user app on SQLite, and one
# process avoids write contention between autosaves.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "1", "--threads", "4", \
     "--access-logfile", "-", "--error-logfile", "-"]
