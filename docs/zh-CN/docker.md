# Docker 部署指南

## 前置要求

- 已安装 Docker 与 Docker Compose
- 当前仓库根目录包含：`Dockerfile`、`docker-compose.yml`

## 方式一：Docker 命令

1. 构建镜像

```bash
docker build -t api-aggregator:latest .
```

2. 运行容器

```bash
docker run -d \
  --name api-aggregator \
  -p 4141:4141 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/pool_files:/app/pool_files" \
  --restart unless-stopped \
  api-aggregator:latest
```

3. 查看日志

```bash
docker logs -f api-aggregator
```

4. 停止与删除

```bash
docker rm -f api-aggregator
```

## 方式二：Docker Compose

1. 启动

```bash
docker compose up -d --build
```

2. 查看状态

```bash
docker compose ps
```

3. 查看日志

```bash
docker compose logs -f
```

4. 停止并清理容器

```bash
docker compose down
```

## 目录与端口说明

- Dashboard: `http://127.0.0.1:4141`
- 宿主机 `./data` 挂载到容器 `/app/data`
- 宿主机 `./pool_files` 挂载到容器 `/app/pool_files`

## 常见问题

1. 无法连接 Docker daemon
- 启动 Docker Desktop（或 Linux Docker 服务）后重试。

2. 端口冲突
- 修改映射端口，例如：`-p 5141:4141`。

3. 数据未持久化
- 确认挂载路径存在且容器启动参数包含 `-v`（或 Compose `volumes`）。
