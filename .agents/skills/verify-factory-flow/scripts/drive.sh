#!/usr/bin/env bash
# Runs one steps file against a launched verification office and files its evidence.
#
#   .agents/skills/verify-factory-flow/scripts/drive.sh <RUN> <steps.mjs|-> <name>
#
# "-" runs no steps (a companion check that saves office.png).
# Writes $EVIDENCE/<name>/: the screenshots, transcript.txt (everything the runner printed) and
# exit-code. Exits with the runner's code.
set -euo pipefail

[[ $# -ge 3 ]] || { sed -n '2,10p' "$0" >&2; exit 2; }
RUN=$1 STEPS=$2 NAME=$3
[[ $# == 3 ]] || { echo "drive: use the browser runner; test Mac windows separately with a properly signed app" >&2; exit 2; }
[[ -f "$RUN/verify.env" ]] || { echo "drive: $RUN has no verify.env: start one with launch.sh" >&2; exit 1; }
# shellcheck source=/dev/null
source "$RUN/verify.env"
source "$(dirname "$0")/run-process.sh"
owns_listener "$PORT" "$PID" || { echo "drive: :$PORT is not owned by this run" >&2; exit 1; }
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "drive: name must be a plain word" >&2; exit 2; }

OUT="$EVIDENCE/$NAME"
mkdir -p "$OUT"
ARGS=("$CHECKOUT/.agents/skills/flow-clone/scripts/flow-run.mjs" "$RUN")
[[ "$STEPS" == - ]] || ARGS+=("$(cd "$(dirname "$STEPS")" && pwd)/$(basename "$STEPS")")
ARGS+=(--out "$OUT" --timeout "${VERIFY_TIMEOUT:-180}")
BROWSERS=$(cd "$CHECKOUT" && node bin/factory-flow.js browser path)

set +e
FACTORY_FLOW_BROWSERS_PATH="$BROWSERS" VERIFY_RUN=$RUN VERIFY_EVIDENCE=$EVIDENCE VERIFY_OUT=$OUT node "${ARGS[@]}" 2>&1 | tee "$OUT/transcript.txt"
code=${PIPESTATUS[0]}
set -e
echo "$code" >"$OUT/exit-code"
echo "drive: $NAME exited $code; evidence in $OUT"
exit "$code"
