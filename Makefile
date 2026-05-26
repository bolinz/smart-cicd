.PHONY: build-builder build-services build-service push-services clean

REGISTRY ?= ghcr.io/bolinz/smart-cicd
GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo "local")

# ── Build ─────────────────────────────────────────────────────────────────────

# Build all service images using root Dockerfile targets
build-services: build-builder
	@echo "Building pod-watcher..."
	docker build --target runtime-watcher-pod -f Dockerfile -t $(REGISTRY)/pod-watcher:$(GIT_SHA) .
	@echo "Building job-watcher..."
	docker build --target runtime-watcher-job -f Dockerfile -t $(REGISTRY)/job-watcher:$(GIT_SHA) .
	@echo "Building event-watcher..."
	docker build --target runtime-watcher-event -f Dockerfile -t $(REGISTRY)/event-watcher:$(GIT_SHA) .
	@echo "Building log-tailer..."
	docker build --target runtime-watcher-log -f Dockerfile -t $(REGISTRY)/log-tailer:$(GIT_SHA) .
	@echo "Building rule-engine..."
	docker build --target runtime-rule-engine -f Dockerfile -t $(REGISTRY)/rule-engine:$(GIT_SHA) .
	@echo "Building control-plane..."
	docker build --target runtime-control-plane -f Dockerfile -t $(REGISTRY)/control-plane:$(GIT_SHA) .
	@echo "Building action-engine..."
	docker build --target runtime-action-engine -f Dockerfile -t $(REGISTRY)/action-engine:$(GIT_SHA) .
	@echo "Building ai-supervisor..."
	docker build --target runtime-ai-supervisor -f Dockerfile -t $(REGISTRY)/ai-supervisor:$(GIT_SHA) .
	@echo "Building ui..."
	docker build --target runtime-ui -f Dockerfile -t $(REGISTRY)/ui:$(GIT_SHA) .
	@echo "Building api-server..."
	docker build --target runtime-api-server -f Dockerfile -t $(REGISTRY)/api-server:$(GIT_SHA) .
	@echo "All service images built."

# Build root builder stage (TypeScript compilation)
build-builder:
	docker build -t smart-cicd-builder:$(GIT_SHA) .

# Build a single service (e.g. make build-service SERVICE=rule-engine)
build-service:
	@case "$(SERVICE)" in \
		pod-watcher)    TARGET=runtime-watcher-pod    ;; \
		job-watcher)    TARGET=runtime-watcher-job    ;; \
		event-watcher) TARGET=runtime-watcher-event  ;; \
		log-tailer)    TARGET=runtime-watcher-log    ;; \
		rule-engine)   TARGET=runtime-rule-engine     ;; \
		control-plane) TARGET=runtime-control-plane   ;; \
		action-engine) TARGET=runtime-action-engine   ;; \
		ai-supervisor) TARGET=runtime-ai-supervisor  ;; \
		ui)            TARGET=runtime-ui              ;; \
		api-server)    TARGET=runtime-api-server     ;; \
		*) echo "Unknown SERVICE=$(SERVICE)"; exit 1 ;; \
	esac
	docker build --target $$TARGET -f Dockerfile -t $(REGISTRY)/$(SERVICE):$(GIT_SHA) .

# ── Push ──────────────────────────────────────────────────────────────────────

push-services: build-services
	@echo "Pushing all service images to $(REGISTRY)..."
	docker push $(REGISTRY)/pod-watcher:$(GIT_SHA)
	docker push $(REGISTRY)/job-watcher:$(GIT_SHA)
	docker push $(REGISTRY)/event-watcher:$(GIT_SHA)
	docker push $(REGISTRY)/log-tailer:$(GIT_SHA)
	docker push $(REGISTRY)/rule-engine:$(GIT_SHA)
	docker push $(REGISTRY)/control-plane:$(GIT_SHA)
	docker push $(REGISTRY)/action-engine:$(GIT_SHA)
	docker push $(REGISTRY)/ai-supervisor:$(GIT_SHA)
	docker push $(REGISTRY)/ui:$(GIT_SHA)
	docker push $(REGISTRY)/api-server:$(GIT_SHA)
	@echo "All images pushed."

# ── E2E ─────────────────────────────────────────────────────────────────────

.PHONY: local-e2e

# One-command local e2e: deploy + test + cleanup
local-e2e:
	scripts/local-e2e-startup.sh
	npm run test:e2e
	scripts/local-e2e-cleanup.sh

# ── Clean ─────────────────────────────────────────────────────────────────────

clean:
	@for svc in pod-watcher job-watcher event-watcher log-tailer rule-engine control-plane action-engine ai-supervisor ui api-server; do \
		docker rmi $(REGISTRY)/$$svc:$(GIT_SHA) 2>/dev/null || true; \
	done
	docker rmi smart-cicd-builder:$(GIT_SHA) 2>/dev/null || true
	@echo "Local images cleaned."

# ── Info ──────────────────────────────────────────────────────────────────────

info:
	@echo "Registry: $(REGISTRY)"
	@echo "Git SHA:  $(GIT_SHA)"
	@echo "Services: pod-watcher job-watcher event-watcher log-tailer rule-engine control-plane action-engine ai-supervisor ui api-server"
