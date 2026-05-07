#!/usr/bin/env bash
#
# verify-pricing.sh — CLI wrapper for the verify-pricing skill
#
# This script invokes the verify-pricing skill to check provider pricing
# accuracy against current provider documentation.
#
# Usage:
#   ./scripts/verify-pricing.sh
#
# The skill will:
# - Fetch pricing pages for all providers
# - Extract current pricing data
# - Compare against src/pricing.ts
# - Report mismatches
# - Auto-update lastVerified dates when all fields match
# - Prompt for confirmation before applying changes when mismatches exist

set -euo pipefail

# Check if reygent CLI is available
if ! command -v reygent &>/dev/null; then
  echo "Error: reygent CLI not found in PATH"
  echo "Build and link the CLI first:"
  echo "  npm run build"
  echo "  npm link"
  exit 1
fi

# Invoke the verify-pricing skill
echo "Invoking verify-pricing skill..."
echo ""

# Assuming the skill is invoked via reygent run command with skill flag
# Adjust this command based on actual reygent CLI interface
reygent run --skill verify-pricing

echo ""
echo "Pricing verification complete."
