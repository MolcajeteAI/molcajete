#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_JSON="$SCRIPT_DIR/../package.json"

current=$(grep -o '"version": "[^"]*"' "$PACKAGE_JSON" | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
IFS='.' read -r major minor patch <<< "$current"

case "${1:-patch}" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) echo "Usage: $0 [major|minor|patch]" >&2; exit 1 ;;
esac

new="$major.$minor.$patch"
sed -i '' "s/\"version\": \"$current\"/\"version\": \"$new\"/" "$PACKAGE_JSON"
echo "$current -> $new"
