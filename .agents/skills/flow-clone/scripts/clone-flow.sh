#!/usr/bin/env bash
# Copies the owner's installed Factory Flow (or, until it is installed, their Droid Office) into a scratch folder, so a build can be tested against
# their real configuration without touching the office they use: the office folder (Factory, Jira and
# Linear connections, floors, prompts, theme, credits ledger), every floor as a clone of its checkout
# with its real `origin`, each floor's own state (Whiteboard, team, Linear board setup),
# and the Mac app's browser settings (profile, per-desk models).
#
# The source may keep its state in `.factory-flow/` or, for a Droid Office office, in `.droid-office/`.
# The scratch copy is always `.factory-flow/`, and the source is only ever read.
#
#   .agents/skills/flow-clone/scripts/clone-flow.sh [--fresh | --office DIR] [--dest DIR] [--port N]
#
# Prints the folder and writes two files into it:
#   start.sh             starts this checkout's built office (dist/) on the copy, on 127.0.0.1
#   local-storage.json   the Mac app's factory-flow.* localStorage
#   load-settings.js     an expression that puts those into a test tab and reloads it (see SKILL.md)
#
# Left out or disarmed on purpose, because a started office acts on them:
#   workers.json, cloud-workers.json, guests.json  a started office resumes every saved worker, so a
#                                                  copy would run the owner's real sessions twice
#   linear-floor.json autopilot.on & links         keeps team/project setup, turns autopilot off, clears links
#   pty.sock, pty-host.*, hook-port, shell.*       the running office's terminals and hooks
#   scrollback/, worktrees/, drops/, images/, wiki-run*  other workers' terminals, checkouts, media and runs
set -euo pipefail

REAL_HOME=$HOME
OFFICE=""
DEST=""
PORT=""
FRESH=false
while [[ $# -gt 0 ]]; do
  [[ "$1" != --office && "$1" != --dest && "$1" != --port || $# -ge 2 ]] || { echo "clone-flow: $1 needs a value" >&2; exit 2; }
  case "$1" in
    --fresh) FRESH=true; shift ;;
    --office) OFFICE=$2; shift 2 ;;
    --dest) DEST=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    -h | --help) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "clone-flow: unknown option $1" >&2; exit 2 ;;
  esac
done

CHECKOUT=$(cd "$(dirname "$0")/../../../.." && pwd)
APP_DATA="$REAL_HOME/Library/Application Support/com.nikships.factory-flow"
LEGACY_APP_DATA="$REAL_HOME/Library/Application Support/com.nikships.droid-office"

has_state() { [[ -f "$1/.factory-flow/floors.json" || -f "$1/.droid-office/floors.json" ]]; }

if [[ "$FRESH" == true && -n "$OFFICE" ]]; then
  echo "clone-flow: --fresh and --office cannot be combined" >&2
  exit 2
fi

app_office_dir() { # <app data dir>: the office folder its settings.json names
  [[ -f "$1/settings.json" ]] || return 0
  node -e 'const s=require(process.argv[1]); if (s.officeDir) console.log(s.officeDir)' "$1/settings.json"
}

# The office the owner runs: --office, else the first of $FACTORY_FLOW_HOME, the Mac app's officeDir and
# ~/factory-flow, then the Droid Office equivalents ($DROID_OFFICE_HOME, its app's officeDir, ~/droid-office).
if [[ "$FRESH" == false && -z "$OFFICE" ]]; then
  for candidate in "${FACTORY_FLOW_HOME:-}" "$(app_office_dir "$APP_DATA")" "$REAL_HOME/factory-flow" \
    "${DROID_OFFICE_HOME:-}" "$(app_office_dir "$LEGACY_APP_DATA")" "$REAL_HOME/droid-office"; do
    if [[ -n "$candidate" ]] && has_state "$candidate"; then OFFICE=$candidate; break; fi
  done
fi
if [[ "$FRESH" == false ]] && ! has_state "${OFFICE:-/nonexistent}"; then
  echo "clone-flow: no office in ${OFFICE:-any default location} (no .factory-flow/ or .droid-office/ floors.json); pass --office" >&2
  exit 1
fi
LEGACY=false
if [[ "$FRESH" == false && ! -f "$OFFICE/.factory-flow/floors.json" ]]; then LEGACY=true; fi

if [[ -n "$PORT" ]]; then
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || { echo "clone-flow: --port takes a number" >&2; exit 2; }
  PORT=$((10#$PORT))
  [[ "$PORT" -ge 1 && "$PORT" -le 65535 && "$PORT" -ne 4700 ]] || { echo "clone-flow: --port takes a number from 1 to 65535 other than 4700" >&2; exit 2; }
fi
[[ -f "$CHECKOUT/dist/server/server/cli.js" ]] || { echo "clone-flow: run npm run build before preparing an office" >&2; exit 1; }
BROWSERS=$(cd "$CHECKOUT" && node bin/factory-flow.js browser path)

# The copy holds the owner's Factory and Jira keys: only they may read it.
DEST=${DEST:-$(mktemp -d /tmp/flow-clone-XXXX)}
mkdir -p "$DEST/office" "$DEST/home" "$DEST/floors"
chmod 700 "$DEST"

if [[ -z "$PORT" ]]; then
  PORT=4677
  while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
fi
[[ "$PORT" -le 65535 ]] || { echo "clone-flow: no free port" >&2; exit 1; }

if [[ "$FRESH" == true ]]; then
  git clone -q --local -- "$CHECKOUT" "$DEST/floors/factory-flow"
  git -C "$DEST/floors/factory-flow" remote set-url origin "$(git -C "$CHECKOUT" remote get-url origin)"
  echo '{"factory-flow.profile":"{\"name\":\"Verifier\",\"color\":\"#4f86f7\"}"}' >"$DEST/local-storage.json"
else
EXCLUDES=(--exclude workers.json --exclude cloud-workers.json --exclude guests.json
  --exclude /orchestrator/
  --exclude remote-workers.json --exclude remote-mcp.json
  --exclude pty.sock --exclude 'pty-host.*' --exclude hook-port --exclude 'shell.*'
  --exclude scrollback/ --exclude worktrees/ --exclude drops/ --exclude images/ --exclude 'wiki-run*'
  --exclude bin/ --exclude 'droid-*.json' --exclude 'system-*.md' --exclude grok-home/ --exclude muse-home/)

copy_state() { # <from dir> <to dir>: its .factory-flow (or legacy .droid-office) folder into .factory-flow, minus what a started office would act on
  local src="$1/.factory-flow"
  [[ -d "$src" ]] || src="$1/.droid-office"
  [[ -d "$src" ]] || return 0
  mkdir -p "$2/.factory-flow"
  rsync -a "${EXCLUDES[@]}" "$src/" "$2/.factory-flow/"
  if [[ -f "$2/.factory-flow/linear-floor.json" || -L "$2/.factory-flow/linear-floor.json" ]]; then
    node -e '
const fs = require("fs");
const file = process.argv[1];
let s;
try {
  s = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  fs.rmSync(file, { force: true });
  process.exit(0);
}
if (!s || typeof s !== "object" || Array.isArray(s)) {
  fs.rmSync(file, { force: true });
  process.exit(0);
}
if (s.autopilot && typeof s.autopilot === "object" && !Array.isArray(s.autopilot)) {
  s.autopilot = { ...s.autopilot, on: false };
} else {
  delete s.autopilot;
}
s.links = [];
if ("skipped" in s) s.skipped = {};
const tmp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(tmp, 0o600);
fs.renameSync(tmp, file);
' "$2/.factory-flow/linear-floor.json" </dev/null
  fi
}

echo "==> office $OFFICE -> $DEST/office"
copy_state "$OFFICE" "$DEST/office"

# Each floor: Home becomes the scratch home folder, a project a local clone with the real origin.
# Rewrites the copied floors.json to point there, and prints id, real folder and copy for each.
MAP=$(node -e '
const fs = require("fs");
const [file, realHome, dest] = process.argv.slice(1);
const norm = (p) => { try { return fs.realpathSync(p); } catch { return p.replace(/\/+$/, ""); } };
const floors = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = [];
for (const f of floors) {
  if (!/^[\w-]{1,64}$/.test(f.id)) throw new Error(`floor id ${JSON.stringify(f.id)} is not a plain name`);
  const to = norm(f.dir) === norm(realHome) ? `${dest}/home` : `${dest}/floors/${f.id}`;
  rows.push([f.id, f.dir, to].join("\t"));
  f.dir = to;
}
fs.writeFileSync(`${file}.tmp`, JSON.stringify(floors, null, 2) + "\n");
fs.renameSync(`${file}.tmp`, file);
console.log(rows.join("\n"));
' "$DEST/office/.factory-flow/floors.json" "$REAL_HOME" "$DEST")

# Read on fd 3: git and rsync in the loop may read stdin.
while IFS=$'\t' read -r -u 3 id from to; do
  [[ -n "$id" ]] || continue
  if [[ "$to" == "$DEST/home" ]]; then
    echo "==> floor $id (Home) -> $to"
  elif git -C "$from" rev-parse --git-dir >/dev/null 2>&1; then
    echo "==> floor $id $from -> $to"
    # A shallow or partial checkout can't be copied whole; the tip of each of its branches can.
    if [[ "$(git -C "$from" rev-parse --is-shallow-repository)" == true || -n "$(git -C "$from" config --get remote.origin.promisor || true)" ]]; then
      git clone -q --depth 1 --no-single-branch -- "file://$from" "$to"
    else
      git clone -q --local -- "$from" "$to"
    fi
    origin=$(git -C "$from" remote get-url origin 2>/dev/null || true)
    if [[ -n "$origin" ]]; then git -C "$to" remote set-url origin "$origin"; else git -C "$to" remote remove origin; fi
    git -C "$to" fetch -q origin 2>/dev/null || true
  else
    echo "==> floor $id $from (not a git checkout) -> $to"
    mkdir -p "$to"
  fi
  copy_state "$from" "$to"
done 3<<<"$MAP"
fi

# HOME is the scratch home: the office always adds a Home floor there, and the owner's real one holds
# their workers. gh and git keep the owner's sign-in, so the boards read the real forge; the
# Whiteboard renderer uses the owner's downloaded Chromium. %q keeps any path a single word.
{
  echo '#!/usr/bin/env bash'
  printf 'cd %q\n' "$CHECKOUT"
  printf 'export HOME=%q\n' "$DEST/home"
  printf 'export GH_CONFIG_DIR=%q\n' "${GH_CONFIG_DIR:-$REAL_HOME/.config/gh}"
  printf 'export GIT_CONFIG_GLOBAL=%q\n' "$REAL_HOME/.gitconfig"
  printf 'export FACTORY_FLOW_BROWSERS_PATH=%q\n' "$BROWSERS"
  echo 'unset FACTORY_FLOW_HOME FACTORY_FLOW_WORKER_ID FACTORY_FLOW_HOOK_TOKEN'
  # A clone leaves the owner's tailnet alone unless the run asks for it (FACTORY_FLOW_REMOTE_MCP=on ./start.sh).
  echo 'export FACTORY_FLOW_REMOTE_MCP="${FACTORY_FLOW_REMOTE_MCP:-off}"'
  printf 'exec node bin/factory-flow.js '
  [[ "$FRESH" == false ]] || printf '%q ' "$DEST/floors/factory-flow"
  printf -- '--home %q --port %s --host 127.0.0.1 --projects %q "$@"\n' "$DEST/office" "$PORT" "$DEST/floors"
} >"$DEST/start.sh"
chmod 700 "$DEST/start.sh"

LS_APP=$APP_DATA
LS_PREFIX=factory-flow
if [[ "$LEGACY" == true ]]; then LS_APP=$LEGACY_APP_DATA; LS_PREFIX=droid-office; fi
if [[ "$FRESH" == false && -d "$LS_APP/Local Storage/leveldb" ]]; then
  echo "==> the Mac app's browser settings -> $DEST/local-storage.json"
  if out=$("$(dirname "$0")/export-local-storage.sh" "$LS_APP/Local Storage/leveldb" "$DEST/local-storage.json" "$LS_PREFIX" 2>&1); then
    echo "    $out"
    # One expression for the test tab: puts every setting in, then reloads into the owner's profile.
    # Concatenated, not a template literal: a stored value can hold a backtick or ${.
    node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(process.argv[2], "(() => { const d = " + JSON.stringify(d) + "; for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); setTimeout(() => location.reload(), 50); return Object.keys(d).length + \" settings\"; })()\n");
' "$DEST/local-storage.json" "$DEST/load-settings.js"
  else
    echo "    skipped (the test tab uses browser defaults): $(echo "$out" | tail -1)"
  fi
fi

echo
if [[ "$FRESH" == true ]]; then echo "Created a fresh office in $DEST"; else echo "Cloned the office in $OFFICE to $DEST$([[ "$LEGACY" == true ]] && echo ' (read from its legacy .droid-office/ state)')"; fi
echo "Start it (fireAndForget):  $DEST/start.sh"
echo "Then open:                 http://127.0.0.1:$PORT/"
