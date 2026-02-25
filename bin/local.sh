#!/bin/bash
set -e

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="${1:-/tmp/thepopebot.local}"
ENV_BACKUP="/tmp/env.$(uuidgen)"

# Build local package artifacts so file-linked installs can resolve
# lib/chat/components/*.js exports during Next.js dev/build.
echo "Building local package artifacts..."
(cd "$PACKAGE_DIR" && npm run build >/dev/null)

HAS_ENV=false
if [ -f "$DEV_DIR/.env" ]; then
  mv "$DEV_DIR/.env" "$ENV_BACKUP"
  HAS_ENV=true
fi

rm -rf "$DEV_DIR"
mkdir -p "$DEV_DIR"
cd "$DEV_DIR"

node "$PACKAGE_DIR/bin/cli.js" init

# Install from a packed tarball instead of file: symlinks, which can break
# Next.js/Turbopack module resolution in some local environments.
PACKAGE_TGZ="$(npm pack "$PACKAGE_DIR" --silent)"
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.dependencies.thepopebot='file:${PACKAGE_TGZ}';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"

rm -rf node_modules package-lock.json
npm install --install-links


if [ "$HAS_ENV" = true ]; then
  mv "$ENV_BACKUP" .env
  echo "Restored .env from previous build"
else
  npm run setup
fi
