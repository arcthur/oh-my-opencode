#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required to discover test files" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  SEARCH_PATHS=(test bin script src)
else
  SEARCH_PATHS=("$@")
fi

mapfile -t mock_heavy_tests < <(
  rg -l --glob '**/*.test.ts' --glob '**/*.spec.ts' "mock\\.module\\(" "${SEARCH_PATHS[@]}"
)

if [ "${#mock_heavy_tests[@]}" -eq 0 ]; then
  echo "No mock-heavy tests found."
else
  printf 'Running %s mock-heavy test files in isolation\n' "${#mock_heavy_tests[@]}"
  for test_file in "${mock_heavy_tests[@]}"; do
    echo "-> $test_file"
    bun test "$test_file"
  done
fi

mapfile -t all_tests < <(
  rg -l --glob '**/*.test.ts' --glob '**/*.spec.ts' "." "${SEARCH_PATHS[@]}"
)

declare -A mock_heavy_lookup=()
for test_file in "${mock_heavy_tests[@]}"; do
  mock_heavy_lookup["$test_file"]=1
done

remaining_tests=()
for test_file in "${all_tests[@]}"; do
  if [ -z "${mock_heavy_lookup[$test_file]+x}" ]; then
    remaining_tests+=("$test_file")
  fi
done

if [ "${#remaining_tests[@]}" -eq 0 ]; then
  echo "No non-mock-heavy tests found."
else
  printf 'Running %s non-mock-heavy test files\n' "${#remaining_tests[@]}"
  bun test "${remaining_tests[@]}"
fi
