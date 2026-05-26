#!/bin/bash
#
# local-e2e-startup.sh - Start local Kubernetes cluster for e2e testing
#
# This script:
# 1. Verifies the current kubectl context is a local cluster (Colima or kind)
# 2. Starts Colima with Kubernetes if not already running (unless --skip-colima)
# 3. Starts a local Docker registry accessible from the cluster VM
# 4. Builds and pushes service images to the local registry
# 5. Deploys services to the cluster
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTRY_PORT=5000

SKIP_COLIMA=false
if [[ "$1" == "--skip-colima" ]]; then
  SKIP_COLIMA=true
  shift
fi

echo "=== Verifying local Kubernetes cluster ==="

# Function to check if current context is a local cluster (Colima or kind)
is_local_cluster() {
  local context
  context=$(kubectl config current-context 2>/dev/null || echo "")
  [[ "$context" == "colima" ]] || [[ "$context" == colima-* ]] || \
  [[ "$context" == "kind" ]] || [[ "$context" == kind-* ]]
}

# Check if we're on a local cluster
if ! is_local_cluster; then
  echo "ERROR: Current kubectl context is not a local cluster."
  echo "Current context: $(kubectl config current-context 2>/dev/null || echo 'none')"
  echo "Please connect to a local Colima or kind Kubernetes cluster."
  echo ""
  echo "To create a Colima Kubernetes cluster:"
  echo "  colima start --kubernetes --cpu 4 --memory 8 --disk 50"
  exit 1
fi

echo "Verified: Current context is a local cluster: $(kubectl config current-context)"

if ! $SKIP_COLIMA; then
  echo "=== Starting Colima Kubernetes cluster ==="
  if ! colima status 2>/dev/null | grep -q "Running"; then
    echo "Creating new Colima instance with Kubernetes..."
    colima start --kubernetes --cpu 4 --memory 8 --disk 50 --timeout 15m
  else
    echo "Colima is already running"
  fi
fi

echo "=== Verifying kubectl context ==="
kubectl config current-context
kubectl get nodes

echo "=== Starting local Docker registry ==="
# Check if registry is already running
if docker ps | grep -q "registry"; then
  echo "Registry is already running"
else
  docker run -d -p $REGISTRY_PORT:5000 --name registry registry:2
  echo "Registry started on port $REGISTRY_PORT"
fi

# For localhost access from Colima VM, we use the host's registry
# Colima VM can access host's localhost via the docker bridge
REGISTRY_HOST="localhost"

echo "=== Building service images ==="
cd "$PROJECT_ROOT"

# Build all service images with local registry
export REGISTRY="$REGISTRY_HOST:$REGISTRY_PORT"
make build-services REGISTRY=$REGISTRY

echo "=== Pushing images to local registry ==="
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
for svc in pod-watcher job-watcher event-watcher log-tailer rule-engine control-plane action-engine ai-supervisor ui api-server; do
  echo "Pushing $REGISTRY/$svc:$GIT_SHA..."
  docker push $REGISTRY/$svc:$GIT_SHA || echo "Warning: Failed to push $svc, continuing..."
done

echo "=== Waiting for cluster to be ready ==="
kubectl wait --for=condition=Ready nodes --all --timeout=5m || true

echo "=== Injecting git SHA into Kustomize overlay ==="
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
sed -i '' "s/GIT_SHA/$GIT_SHA/g" "$PROJECT_ROOT/k8s/overlays/local-e2e/kustomization.yaml"

echo "=== Deploying to Kubernetes ==="
kubectl apply -k "$PROJECT_ROOT/k8s/overlays/local-e2e"

# Restore placeholder for future runs
sed -i '' "s/$GIT_SHA/GIT_SHA/g" "$PROJECT_ROOT/k8s/overlays/local-e2e/kustomization.yaml"

echo "=== Waiting for pods to be ready ==="
kubectl wait --for=condition=Ready pods -n smart-cicd --all --timeout=5m || {
  echo "Warning: Some pods may not be ready yet"
  kubectl get pods -n smart-cicd
}

echo "=== Setting up port-forward to api-server ==="
kubectl port-forward -n smart-cicd svc/api-server 8080:8080 &
PF_PID=$!
echo "Port-forward PID: $PF_PID"

# Wait for port-forward to be established
sleep 3
if ! curl -s http://localhost:8080/health > /dev/null 2>&1; then
  echo "Warning: api-server health check failed, continuing anyway..."
fi

# Cleanup port-forward on script exit or interrupt
cleanup() {
  echo "Cleaning up port-forward..."
  kill $PF_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Deployment complete ==="
kubectl get pods -n smart-cicd
echo ""
echo "E2E environment is ready!"
echo "Registry: $REGISTRY_HOST:$REGISTRY_PORT"
echo ""
echo "To run e2e tests:"
echo "  npm run test:e2e"
echo ""
echo "To view logs:"
echo "  kubectl logs -n smart-cicd -l app=control-plane"
