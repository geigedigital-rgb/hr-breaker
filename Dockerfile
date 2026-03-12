# syntax=docker/dockerfile:1
# BuildKit: cache mounts speed up repeated deploys (pip, npm, Playwright browsers)

# Stage 1: build React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve frontend
FROM python:3.11-slim

WORKDIR /app

# System deps for WeasyPrint and build (layer rarely changes)
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    gcc \
    libffi-dev \
    libcairo2 \
    libpango-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Python deps and app
COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# Playwright: only Chromium (no cache mount — browsers must be in image for runtime)
RUN python -m playwright install chromium --with-deps

# Copy built frontend from stage 1 (API serves SPA at /)
COPY --from=frontend-build /app/frontend/dist ./frontend_dist

ENV PORT=8080
EXPOSE 8080

# Shell form so Railway's PORT env is applied
CMD uvicorn hr_breaker.api:app --host 0.0.0.0 --port ${PORT}
