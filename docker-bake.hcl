# Docker Bake — 声明式多服务构建定义
# 用法: docker buildx bake [--push]
# 调试: docker buildx bake --print

variable "REGISTRY" {
  default = "ghcr.io/bolinz/smart-cicd"
}

variable "GIT_SHA" {
  default = "local"
}

# ── Builder stage（所有 runtime 的前置依赖）─────────────────────────────────

target "builder" {
  target = "builder"
}

# ── Runtime stages ──────────────────────────────────────────────────────────────

target "pod-watcher" {
  inherits = ["builder"]
  target   = "runtime-watcher-pod"
  tags     = ["${REGISTRY}/pod-watcher:${GIT_SHA}"]
}

target "job-watcher" {
  inherits = ["builder"]
  target   = "runtime-watcher-job"
  tags     = ["${REGISTRY}/job-watcher:${GIT_SHA}"]
}

target "event-watcher" {
  inherits = ["builder"]
  target   = "runtime-watcher-event"
  tags     = ["${REGISTRY}/event-watcher:${GIT_SHA}"]
}

target "log-tailer" {
  inherits = ["builder"]
  target   = "runtime-watcher-log"
  tags     = ["${REGISTRY}/log-tailer:${GIT_SHA}"]
}

target "rule-engine" {
  inherits = ["builder"]
  target   = "runtime-rule-engine"
  tags     = ["${REGISTRY}/rule-engine:${GIT_SHA}"]
}

target "control-plane" {
  inherits = ["builder"]
  target   = "runtime-control-plane"
  tags     = ["${REGISTRY}/control-plane:${GIT_SHA}"]
}

target "action-engine" {
  inherits = ["builder"]
  target   = "runtime-action-engine"
  tags     = ["${REGISTRY}/action-engine:${GIT_SHA}"]
}

target "ai-supervisor" {
  inherits = ["builder"]
  target   = "runtime-ai-supervisor"
  tags     = ["${REGISTRY}/ai-supervisor:${GIT_SHA}"]
}

target "ui" {
  inherits = ["builder"]
  target   = "runtime-ui"
  tags     = ["${REGISTRY}/ui:${GIT_SHA}"]
}

target "api-server" {
  inherits = ["builder"]
  target   = "runtime-api-server"
  tags     = ["${REGISTRY}/api-server:${GIT_SHA}"]
}

# ── Default group（docker buildx bake 默认构建全部）───────────────────────────

group "default" {
  targets = [
    "pod-watcher",
    "job-watcher",
    "event-watcher",
    "log-tailer",
    "rule-engine",
    "control-plane",
    "action-engine",
    "ai-supervisor",
    "ui",
    "api-server",
  ]
}