#!/usr/bin/env bash
# chunk-conversation.sh
#
# Adapted from ai-collab-dev/scripts/chunk-conversation.sh in wojons/skills
# (https://github.com/wojons/skills, MIT License).
#
# Split a saved AI conversation into numbered chunks. Each chunk starts at a line
# beginning with "Human:", "User:" or "Me:" and runs until the next such line, so it
# holds one human message and the replies that follow it. Text before the first
# human line is dropped.
#
# Usage: chunk-conversation.sh [--out <dir>] [--force] <conversation-file>
#
# Output directory, in order of precedence:
#   1. --out <dir>
#   2. $INTERSTAGE_STATE_DIR/missions/$INTERSTAGE_MISSION_ID/import/chunks
#      (when both variables are set)
#   3. ./chunks
#
# The script refuses an output directory that already has files in it, so a shorter
# conversation never leaves stale chunks behind. --force deletes the existing
# chunk-*.txt files in that directory first and keeps everything else.
#
# Writes chunk-001.txt, chunk-002.txt, ... and prints one JSON line on stdout:
#   {"chunks": <n>, "output_dir": "<dir>"}
# Progress goes to stderr. Exits non-zero when the input is missing or has no human line.

set -euo pipefail

usage() {
  printf '%s\n' "Usage: $0 [--out <dir>] [--force] <conversation-file>" >&2
}

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  printf '%s' "$s"
}

input=""
out_dir=""
force=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      if [ $# -lt 2 ]; then
        printf '%s\n' "Error: --out needs a directory" >&2
        usage
        exit 2
      fi
      out_dir=$2
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      printf '%s\n' "Error: unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [ -n "$input" ]; then
        printf '%s\n' "Error: more than one input file given" >&2
        usage
        exit 2
      fi
      input=$1
      shift
      ;;
  esac
done

if [ -z "$input" ]; then
  usage
  exit 2
fi

if [ ! -f "$input" ]; then
  printf '%s\n' "Error: file not found: $input" >&2
  exit 1
fi

if [ -z "$out_dir" ]; then
  if [ -n "${INTERSTAGE_STATE_DIR:-}" ] && [ -n "${INTERSTAGE_MISSION_ID:-}" ]; then
    out_dir="$INTERSTAGE_STATE_DIR/missions/$INTERSTAGE_MISSION_ID/import/chunks"
  else
    out_dir="./chunks"
  fi
fi

if ! grep -Eq '^(Human|User|Me):' "$input"; then
  printf '%s\n' "Error: no line starting with Human:, User: or Me: in $input" >&2
  exit 1
fi

if [ -d "$out_dir" ] && [ -n "$(ls -A "$out_dir")" ]; then
  if [ "$force" -ne 1 ]; then
    printf '%s\n' "Error: output directory is not empty: $out_dir (use --force to replace its chunk-*.txt files)" >&2
    exit 1
  fi
  rm -f "$out_dir"/chunk-*.txt
fi

mkdir -p "$out_dir"

printf '%s\n' "Splitting $input into chunks in $out_dir/" >&2

chunk_num=0
chunk_file=""

# `|| [ -n "$line" ]` keeps a final line that has no trailing newline.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    Human:* | User:* | Me:*)
      chunk_num=$((chunk_num + 1))
      chunk_file=$(printf '%s/chunk-%03d.txt' "$out_dir" "$chunk_num")
      printf '%s\n' "$line" >"$chunk_file"
      printf '%s\n' "  Wrote: $(basename "$chunk_file")" >&2
      ;;
    *)
      if [ -n "$chunk_file" ]; then
        printf '%s\n' "$line" >>"$chunk_file"
      fi
      ;;
  esac
done <"$input"

printf '%s\n' "Created $chunk_num chunks in $out_dir/" >&2

printf '{"chunks": %d, "output_dir": "%s"}\n' "$chunk_num" "$(json_escape "$out_dir")"
