#!/usr/bin/env bash
set -euo pipefail

# Deploy Firebase website project.
# Usage: ./deploy-website.sh <project-name>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
  fnm use 22
fi

exec node "$SCRIPT_DIR/deploy-website.js" "$@"
