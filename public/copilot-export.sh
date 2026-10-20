#!/usr/bin/env bash
# Copies raw files only; JSON parsing belongs to the browser.
set -u

usage() {
  cat <<'USAGE'
Usage:
  bash copilot-export.sh [--file path | --session id] [--output new-path]
  bash copilot-export.sh --list
  bash copilot-export.sh --capture --output new-path -- [copilot args]

Without --file or --session, lists session IDs and asks you to select one.
Sessions: ${COPILOT_HOME:-$HOME/.copilot}/session-state/<id>/events.jsonl
Default copy destination: ./copilot-export.jsonl (or .json for a .json source).
Capture starts a NEW copilot invocation; it cannot recover past telemetry.
Raw files can contain private conversations, paths, tool data, or secrets.
Review locally before sharing. No parsing, redaction, uploading, or installation.
USAGE
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
file='' session='' output='' capture=0 list=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file|--session|--output)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 needs a value."
      case "$1" in
        --file) file=$2 ;;
        --session) session=$2 ;;
        --output) output=$2 ;;
      esac
      shift 2 ;;
    --capture) capture=1; shift ;;
    --list) list=1; shift ;;
    --help|-h) usage; exit 0 ;;
    --) shift; break ;;
    *) fail "Unknown option: $1. Use --help." ;;
  esac
done
[ "$capture" -eq 1 ] || [ "$#" -eq 0 ] || fail "CLI arguments require --capture."
[ -z "$file" ] || [ -z "$session" ] || fail "Choose --file or --session, not both."
if [ "$capture" -eq 1 ]; then
  [ -z "$file$session" ] && [ "$list" -eq 0 ] || fail "--capture cannot select an existing file."
  [ -n "$output" ] || fail "--capture requires --output new-path."
  command -v copilot >/dev/null 2>&1 || fail "copilot is not on PATH. Nothing was installed."
else
  [ "$list" -eq 0 ] || { [ -z "$file$session$output" ] || fail "--list cannot be combined with file options."; }
  root="${COPILOT_HOME:-$HOME/.copilot}/session-state"
  if [ -z "$file$session" ]; then
    ids=()
    for path in "$root"/*/events.jsonl; do
      [ -f "$path" ] || continue
      dir=${path%/events.jsonl}
      id=${dir##*/}
      ids+=("$id")
      modified=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S%z' "$path" 2>/dev/null) ||
        modified=$(stat -c '%y' "$path" 2>/dev/null) || modified=unknown
      printf '%d) %s  modified %s\n' "${#ids[@]}" "$id" "$modified"
    done
    [ "${#ids[@]}" -gt 0 ] || fail "No session events.jsonl files found under $root. Use --file path."
    [ "$list" -eq 0 ] || exit 0
    printf 'Select a session number (no default): '
    IFS= read -r choice || fail "Selection required. Use --session id or --file path."
    case "$choice" in ''|*[!0-9]*) fail "Invalid selection." ;; esac
    [ "${#choice}" -le 6 ] || fail "Invalid selection."
    number=$((10#$choice))
    [ "$number" -ge 1 ] && [ "$number" -le "${#ids[@]}" ] || fail "Invalid selection."
    session=${ids[$((number - 1))]}
  fi
  if [ -n "$session" ]; then
    case "$session" in .|..|*/*|*\\*) fail "Use a session ID, not a path." ;; esac
    file="$root/$session/events.jsonl"
  fi
  [ -f "$file" ] && [ -r "$file" ] || fail "Source is missing or unreadable: $file"
  [ -s "$file" ] || fail "Source is empty: $file"
  case "$file" in
    *.[jJ][sS][oO][nN]) extension=json ;;
    *.[jJ][sS][oO][nN][lL]) extension=jsonl ;;
    *) fail "Source must be a .json or .jsonl file." ;;
  esac
  output=${output:-"./copilot-export.$extension"}
fi
case "$output" in
  *.[jJ][sS][oO][nN]|*.[jJ][sS][oO][nN][lL]) ;;
  *) fail "Output must end in .json or .jsonl." ;;
esac
parent=$(cd -- "$(dirname -- "$output")" 2>/dev/null && pwd -P) ||
  fail "Output directory does not exist."
output="$parent/$(basename -- "$output")"
printf 'Privacy warning: this is a RAW file, not redacted. It may contain private content or secrets. Review before sharing.\n'
(
  umask 077
  set -o noclobber
  exec 3>"$output" || exit 1
  if [ "$capture" -eq 0 ]; then
    cat -- "$file" >&3 || exit 1
  fi
) || fail "Cannot create export (existing files are never overwritten): $output"
if [ "$capture" -eq 1 ]; then
  (
    export COPILOT_OTEL_ENABLED=true
    export COPILOT_OTEL_EXPORTER_TYPE=file
    export COPILOT_OTEL_FILE_EXPORTER_PATH="$output"
    export COPILOT_OTEL_CAPTURE_CONTENT=false
    export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
    copilot "$@"
  )
  result=$?
  if [ ! -s "$output" ]; then
    printf 'Error: capture produced no telemetry (file missing or empty): %s\n' "$output" >&2
  else
    printf 'Drag this raw file into the viewer:\n%s\n' "$output"
  fi
  exit "$result"
fi
printf 'Drag this raw file into the viewer:\n%s\n' "$output"
