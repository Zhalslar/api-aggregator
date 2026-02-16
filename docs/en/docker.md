# Docker Deployment Guide

## Prerequisites

- Docker and Docker Compose installed
- Repository root includes `Dockerfile` and `docker-compose.yml`

## Option 1: Docker CLI

1. Build image

```bash
docker build -t api-aggregator:latest .
```

2. Run container

```bash
docker run -d \
  --name api-aggregator \
  -p 4141:4141 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/pool_files:/app/pool_files" \
  --restart unless-stopped \
  api-aggregator:latest
```

3. View logs

```bash
docker logs -f api-aggregator
```

4. Stop and remove

```bash
docker rm -f api-aggregator
```

## Option 2: Docker Compose

1. Start

```bash
docker compose up -d --build
```

2. Check status

```bash
docker compose ps
```

3. View logs

```bash
docker compose logs -f
```

4. Stop and remove containers

```bash
docker compose down
```

## Paths and Port

- Dashboard: `http://127.0.0.1:4141`
- Host `./data` is mounted to container `/app/data`
- Host `./pool_files` is mounted to container `/app/pool_files`

## Troubleshooting

1. Docker daemon is not reachable
- Start Docker Desktop (or Docker service on Linux) and retry.

2. Port conflict
- Change host port mapping, for example `-p 5141:4141`.

3. Data not persisted
- Ensure volume mounts are configured in `docker run` or Compose `volumes`.
