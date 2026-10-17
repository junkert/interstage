#!/usr/bin/env bash
# Run shellcheck over every shell script in the repo (tracked or untracked,
# excluding ignored files). Works with macOS (BSD) and Linux (GNU) userlands.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(git ls-files --cached --others --exclude-standard -- '*.sh')

if [ "${#files[@]}" -eq 0 ]; then
  echo "shellcheck: no shell scripts found"
  exit 0
fi

shellcheck -S warning "${files[@]}"
echo "shellcheck: ${#files[@]} script(s) clean"
