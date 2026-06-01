#!/bin/bash
#
# local-e2e-cleanup.sh - Cleanup e2e testing environment
#
# This script:
# 1. Verifies the current kubectl context is a local cluster (Colima or kind)
# 2. Deletes the smart-cicd namespace
# 3. Stops the local Docker registry
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Verifying local Kubernetes cluster ==="

# Function to check if current context is a local cluster (Colima or kind)
is_local_cluster() {
  local context cluster
  context=$(kubectl config current-context 2>/dev/null || echo "")
  cluster=$(kubectl config get-clusters 2>/dev/null | grep -v NAME | head -1 || echo "")
  [[ "$context" == "colima" ]] || [[ "$context" == colima-* ]] || \
  [[ "$context" == "kind" ]] || [[ "$context" == kind-* ]] || \
  [[ "$cluster" == "kind-"* ]] || [[ "$cluster" == "colima"* ]]
}

# Check if we're on a local cluster
if ! is_local_cluster; then
  echo "ERROR: Current kubectl context is not a local cluster."
  echo "Current context: $(kubectl config current-context 2>/dev/null || echo 'none')"
  echo "Please ensure you are connected to a local Kubernetes cluster."
  exit 1
fi

echo "Verified: Current context is a local cluster: $(kubectl config current-context)"

echo "=== Cleaning up e2e environment ==="

echo "=== Deleting smart-cicd namespace ==="
kubectl delete namespace smart-cicd --wait=true --timeout=60s 2>/dev/null || {
  echo "Namespace may already be deleted or not exist"
}

echo "=== Stopping Docker registry ==="
if docker ps | grep -q "registry"; then
  docker stop registry && docker rm registry
  echo "Registry stopped"
else
  echo "Registry is not running"
fi

echo "=== Cleanup complete ==="
