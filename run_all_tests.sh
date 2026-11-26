#!/usr/bin/env bash
# Runs every check the project has, in order, and stops at the first one that fails:
#   1. type check (tsc)   2. unit tests (vitest)   3. production build   4. end-to-end flow in headless Chromium, as a desktop and as a touch phone
# Usage: ./run_all_tests.sh            everything
#        ./run_all_tests.sh --fast     type check + unit tests only (skips the build and the browser runs)
set -euo pipefail
cd "$(dirname "$0")"

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1/4 type check"
npx tsc -b

step "2/4 unit tests"
npx vitest run

if [[ $FAST == 1 ]]; then
  printf '\n\033[32mType check and unit tests passed (--fast: build and e2e skipped).\033[0m\n'
  exit 0
fi

step "3/4 build"
npm run build

step "4/4 end-to-end (desktop 1024x768, then phone 390x844)"
npm run e2e
E2E_SIZE=390x844 npm run e2e

printf '\n\033[32mAll checks passed.\033[0m\n'
