#!/bin/bash
#
# local-e2e-cleanup.sh - Cleanup e2e testing environment
#
# This script:
# 1. Verifies the current kubectl context is a Colima-created cluster
# 2. Deletes the smart-cicd namespace
# 3. Stops the local Docker registry
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Verifying Colima Kubernetes cluster ==="

# Function to check if current context is Colima
is_colima_cluster() {
  local context
  context=$(kubectl config current-context 2>/dev/null || echo "")
  # Colima typically uses "colima" or "colima-<profile>" as context name
  [[ "$context" == "colima" ]] || [[ "$context" == colima-* ]]
}

# Check if we're on a Colima cluster
if ! is_colima_cluster; then
  echo "ERROR: Current kubectl context is not a Colima cluster."
  echo "Current context: $(kubectl config current-context 2>/dev/null || echo 'none')"
  echo "Please ensure you are connected to a Colima Kubernetes cluster."
  exit 1
fi

echo "Verified: Current context is a Colima cluster: $(kubectl config current-context)"

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
