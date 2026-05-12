#!/usr/bin/env bash
set -euo pipefail

# Release script for protected master branch.
#
# Usage:
#   ./scripts/release.sh prepare [patch|minor|major|<version>]
#   ./scripts/release.sh tag
#
# Steps:
#   1. `prepare` — create release branch, bump version, push, open PR
#   2. Merge PR on GitHub
#   3. `tag` — pull master, tag merge commit, push tag (triggers publish workflow)

COMMAND="${1:-}"
MAIN_BRANCH="master"
REPO_URL=$(git remote get-url origin | sed -E 's|.*[:/]([^/]+/[^/.]+)(\.git)?$|\1|')

if [ -z "$COMMAND" ]; then
  echo "Usage:"
  echo "  ./scripts/release.sh prepare [patch|minor|major|<version>]"
  echo "  ./scripts/release.sh tag"
  exit 1
fi

case "$COMMAND" in
  prepare)
    BUMP="${2:-patch}"

    # Ensure working tree is clean
    if [ -n "$(git status --porcelain)" ]; then
      echo "Error: working tree not clean. Commit or stash changes first."
      exit 1
    fi

    # Start from latest master
    git checkout "$MAIN_BRANCH"
    git pull origin "$MAIN_BRANCH"

    # Bump version in package.json
    if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      npm version "$BUMP" --no-git-tag-version
      VERSION="$BUMP"
    else
      npm version "$BUMP" --no-git-tag-version
      VERSION=$(node -p "require('./package.json').version")
    fi

    BRANCH="release/v$VERSION"

    # Create release branch
    git checkout -b "$BRANCH"

    # Commit version bump
    git add package.json package-lock.json 2>/dev/null || git add package.json
    git commit -m "v$VERSION"

    # Push branch
    git push -u origin "$BRANCH"

    # Open PR
    if command -v gh &>/dev/null; then
      gh pr create --title "Release v$VERSION" --body "Bump version to v$VERSION" --base "$MAIN_BRANCH"
    else
      echo "gh CLI not found. Open PR manually:"
      echo "  https://github.com/$REPO_URL/compare/$MAIN_BRANCH...$BRANCH"
    fi

    echo ""
    echo "Release branch '$BRANCH' pushed with version v$VERSION."
    echo "Merge the PR, then run: ./scripts/release.sh tag"
    ;;

  tag)
    # Ensure on master and up to date
    git checkout "$MAIN_BRANCH"
    git pull origin "$MAIN_BRANCH"

    # Read version from package.json (should have the merged bump)
    VERSION=$(node -p "require('./package.json').version")
    TAG="v$VERSION"

    # Check tag doesn't already exist
    if git rev-parse "$TAG" >/dev/null 2>&1; then
      echo "Error: tag '$TAG' already exists."
      exit 1
    fi

    # Tag and push
    git tag "$TAG"
    git push origin "$TAG"

    echo ""
    echo "Tag '$TAG' pushed. Publish workflow triggered."
    echo "Track it: https://github.com/$REPO_URL/actions"
    ;;

  *)
    echo "Unknown command: $COMMAND"
    echo "Usage:"
    echo "  ./scripts/release.sh prepare [patch|minor|major|<version>]"
    echo "  ./scripts/release.sh tag"
    exit 1
    ;;
esac
