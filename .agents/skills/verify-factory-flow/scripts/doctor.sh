#!/usr/bin/env bash
# Read-only: is this verification office worth driving? Prints one line per check and exits 1 on
# any "fail". Run it first, and again after any drive that failed or surprised you.
#
#   .agents/skills/verify-factory-flow/scripts/doctor.sh <RUN>
set -uo pipefail

RUN=${1:-}
[[ -n "$RUN" && -f "$RUN/verify.env" ]] || { echo "fail  no verify.env in '${RUN}': start an office with launch.sh"; exit 1; }
# shellcheck source=/dev/null
source "$RUN/verify.env"
source "$(dirname "$0")/run-process.sh"
bad=0
ok() { echo "ok    $*"; }
warn() { echo "warn  $*"; }
fail() { echo "fail  $*"; bad=1; }

[[ "$PORT" != 4700 ]] && ok "port :$PORT is not the owner's :4700" || fail "port is :4700, the owner's office"
if kill -0 "$PID" 2>/dev/null; then ok "office pid $PID is alive (mode $MODE)"; else fail "office pid $PID is gone: see $RUN/office.log"; fi

if owns_listener "$PORT" "$PID"; then
  ok "listener on :$PORT belongs to this run's process group"
else
  fail "listener on :$PORT is missing or not this run's office: someone else may own the port"
fi

for path in / /dashboard; do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT$path")
  expected=200
  [[ "$path" != / ]] || expected=302
  [[ "$code" == "$expected" ]] && ok "GET $path $expected" || fail "GET $path answered $code"
done
hookfile=$(find "$RUN" -maxdepth 5 -name hook-port -path '*/.factory-flow/*' 2>/dev/null | head -1)
hook=$([[ -n "$hookfile" ]] && tr -dc '0-9' <"$hookfile")
if [[ -z "$hook" ]]; then
  warn "no hook-port file under $RUN yet: Office MCP checks skipped"
else
  mcp=$(curl -s -o /dev/null -m 5 -w '%{http_code}' -X POST "http://127.0.0.1:$hook/office/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  [[ "$mcp" == 401 || "$mcp" == 403 ]] && ok "Office MCP on hook port :$hook refuses an anonymous call ($mcp)" || fail "Office MCP on :$hook answered an anonymous call with $mcp"
fi

head=$(git -C "$CHECKOUT" rev-parse --short HEAD)
fresh=$(node "$(dirname "$0")/build-freshness.mjs" "$CHECKOUT")
if [[ "$fresh" == stale ]]; then warn "dist/ is older than src/ at $head: npm run build, then relaunch"; elif [[ "$fresh" == current ]]; then ok "serving $CHECKOUT at $head, dist/ newer than src/"; else fail "could not check dist/ freshness"; fi

[[ -f "$RUN/local-storage.json" ]] && ok "browser profile present (local-storage.json)" || warn "no local-storage.json: the companion uses browser defaults"

if command -v adb >/dev/null 2>&1; then
  n=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  ok "adb sees $n Android device(s)"
fi
ok "evidence goes to $EVIDENCE"
exit "$bad"
