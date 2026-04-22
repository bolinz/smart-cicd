# syntax=docker/dockerfile:1
#
# Root multi-stage Dockerfile for smart-cicd
# Build all services: docker build -t smart-cicd:local .
#
# For per-service builds, see services/*/Dockerfile.*

# ── Stage 1: TypeScript compilation ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps only (for better layer caching)
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY services/ ./services/
COPY types/ ./types/

# Compile TypeScript → dist/
RUN npx tsc

# ── Stage 2: Per-service named stages (intermediate artifacts) ────────────────
# These stages hold the compiled output for each service.
# Per-service Dockerfiles COPY --from=docker-image://smart-cicd-builder /app/dist <target>

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-watcher-pod
COPY --from=builder /app/dist/services/watcher/pod-watcher.js /app/
COPY --from=builder /app/dist/services/watcher/types.js /app/
COPY --from=builder /app/dist/services/watcher/normalizer.js /app/
COPY --from=builder /app/dist/services/watcher/event-emitter.js /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["pod-watcher.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-watcher-job
COPY --from=builder /app/dist/services/watcher/job-watcher.js /app/
COPY --from=builder /app/dist/services/watcher/types.js /app/
COPY --from=builder /app/dist/services/watcher/normalizer.js /app/
COPY --from=builder /app/dist/services/watcher/event-emitter.js /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["job-watcher.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-watcher-event
COPY --from=builder /app/dist/services/watcher/event-watcher.js /app/
COPY --from=builder /app/dist/services/watcher/types.js /app/
COPY --from=builder /app/dist/services/watcher/normalizer.js /app/
COPY --from=builder /app/dist/services/watcher/event-emitter.js /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["event-watcher.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-watcher-log
COPY --from=builder /app/dist/services/watcher/log-tailer.js /app/
COPY --from=builder /app/dist/services/watcher/types.js /app/
COPY --from=builder /app/dist/services/watcher/normalizer.js /app/
COPY --from=builder /app/dist/services/watcher/event-emitter.js /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["log-tailer.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-rule-engine
COPY --from=builder /app/dist/services/rule-engine /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-control-plane
COPY --from=builder /app/dist/services/control-plane /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-action-engine
COPY --from=builder /app/dist/services/action-engine /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-ai-supervisor
COPY --from=builder /app/dist/services/ai-supervisor /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-ui
COPY --from=builder /app/dist/services/ui /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]

FROM gcr.io/distroless/nodejs20-debian11 AS runtime-api-server
COPY --from=builder /app/dist/services/api-server /app/
COPY --from=builder /app/dist/services/control-plane /app/
COPY --from=builder /app/dist/services/ai-supervisor /app/
COPY --from=builder /app/dist/services/action-engine /app/
COPY --from=builder /app/dist/services/watcher /app/
COPY --from=builder /app/dist/services/rule-engine /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
WORKDIR /app
ENV NODE_ENV=production
CMD ["index.js"]
