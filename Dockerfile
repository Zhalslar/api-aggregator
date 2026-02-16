FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md LICENSE start.py ./
COPY src ./src

RUN python -m pip install --upgrade pip && \
    pip install .

RUN mkdir -p /app/data /app/pool_files

EXPOSE 4141

VOLUME ["/app/data", "/app/pool_files"]

CMD ["python", "start.py", "--dashboard-host", "0.0.0.0", "--dashboard-port", "4141"]
