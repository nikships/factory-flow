#!/usr/bin/env bash
# Runs ON the EC2 instance (piped over ssh by deploy/aws.sh). Idempotent: safe to re-run.
# Expects these to be exported by the caller: APP_REPO APP_REF PROJECT_REPO (optional)
# GH_TOKEN FACTORY_API_KEY GIT_NAME GIT_EMAIL
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APT=(sudo -E apt-get -y -q -o DPkg::Lock::Timeout=600)

step() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
# Run quietly; show the output only when something fails.
quiet() {
  local log
  log=$(mktemp)
  if ! "$@" >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    echo "provision: failed: $*" >&2
    exit 1
  fi
  rm -f "$log"
}

# Like quiet, but a failure is the caller's to handle.
quiet_soft() {
  local log
  log=$(mktemp)
  if ! "$@" >"$log" 2>&1; then
    tail -n 20 "$log" >&2
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
}

step "Waiting for the instance to finish booting"
sudo cloud-init status --wait >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  step "Installing Node.js 22"
  quiet bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
  quiet "${APT[@]}" install nodejs
fi

step "Installing git, GitHub CLI and build tools"
# gh from GitHub's own apt repo: Ubuntu's archive freezes it at whatever shipped with the release.
# install upgrades it to the newest on every re-run.
sudo install -d -m 755 /etc/apt/keyrings
quiet sudo curl -fsSLo /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
quiet "${APT[@]}" update
quiet "${APT[@]}" install git gh curl ca-certificates build-essential python3
echo "    $(gh --version | head -1)"

if ! command -v droid >/dev/null 2>&1; then
  step "Installing the Droid CLI"
  quiet bash -c 'curl -fsSL https://app.factory.ai/cli | sh'
fi
export PATH="$HOME/.local/bin:$PATH"
if command -v droid >/dev/null 2>&1; then
  echo "    droid $(droid --version 2>/dev/null | head -1)"
else
  echo "    droid not found on PATH — install it from https://docs.factory.ai/cli/getting-started/quickstart"
fi

step "Writing secrets to /etc/factory-flow/env"
sudo install -d -m 755 /etc/factory-flow
env_file=$(mktemp)
{
  [[ -n "${FACTORY_API_KEY:-}" ]] && printf 'FACTORY_API_KEY="%s"\n' "$FACTORY_API_KEY"
  true
} >"$env_file"
sudo install -m 600 -o root -g root "$env_file" /etc/factory-flow/env
rm -f "$env_file"

if [[ -n "${GH_TOKEN:-}" ]]; then
  step "Signing the GitHub CLI in"
  # Stored in gh's own config, so gh, git (via gh's credential helper), the office's boards, the
  # workers and your ssh sessions all use it — and the token never lands in a .git/config.
  printf '%s' "$GH_TOKEN" | quiet env -u GH_TOKEN gh auth login --hostname github.com --git-protocol https --with-token
  quiet env -u GH_TOKEN gh auth setup-git --hostname github.com
  echo "    $(env -u GH_TOKEN gh api user --jq '"as " + .login' 2>/dev/null || echo 'signed in')"
fi
[[ -n "${GIT_NAME:-}" ]] && git config --global user.name "$GIT_NAME"
[[ -n "${GIT_EMAIL:-}" ]] && git config --global user.email "$GIT_EMAIL"
git config --global init.defaultBranch main

step "Installing factory-flow ($APP_REF) from $APP_REPO"
sudo install -d -o "$USER" -g "$USER" /opt/factory-flow
if [[ -d /opt/factory-flow/.git ]]; then
  quiet git -C /opt/factory-flow fetch --depth 1 origin "$APP_REF"
  quiet git -C /opt/factory-flow reset --hard FETCH_HEAD
else
  quiet git clone --depth 1 --branch "$APP_REF" "$APP_REPO" /opt/factory-flow
fi
echo "    at $(git -C /opt/factory-flow log -1 --format='%h %s')"
step "npm install (builds the office)"
(cd /opt/factory-flow && quiet npm install --no-audit --no-fund)

# The Whiteboard renders cards with a headless Chromium, which `factory-flow browser` downloads into one
# folder the service shares. None of this stops the office from starting: a step that fails says so, and
# the Whiteboard reports renders as unavailable until it is fixed.
step "Installing Chromium for the Whiteboard"
BROWSERS="$(node /opt/factory-flow/bin/factory-flow.js browser path 2>/dev/null)" || BROWSERS=""
[[ -n "$BROWSERS" ]] || echo "    (couldn't ask the office where its browser goes; the steps below use its default)"
# The libraries Chromium needs, as root through playwright-core's own command (apt, no other changes).
if ! quiet_soft sudo -E env DEBIAN_FRONTEND=noninteractive node /opt/factory-flow/node_modules/playwright-core/cli.js install-deps chromium; then
  echo "    (carrying on without Chromium's libraries: run 'sudo node /opt/factory-flow/node_modules/playwright-core/cli.js install-deps chromium' on the box)"
fi
# The browser itself, as the office user: no admin rights, into $BROWSERS.
if ! quiet_soft env FACTORY_FLOW_BROWSERS_PATH="$BROWSERS" node /opt/factory-flow/bin/factory-flow.js browser install; then
  echo "    (carrying on without Chromium: run 'factory-flow browser install' as $USER on the box)"
fi
# Ubuntu 23.10 and later stop unprivileged processes from using user namespaces, which Chromium's
# sandbox needs, unless AppArmor has a profile that allows it for that binary. The office never turns
# the sandbox off, so this profile is what lets it render there. Older releases have no such rule.
if [[ -e /etc/apparmor.d/abi/4.0 ]] && command -v apparmor_parser >/dev/null 2>&1; then
  profile=$(mktemp)
  if ! FACTORY_FLOW_BROWSERS_PATH="$BROWSERS" node /opt/factory-flow/bin/factory-flow.js browser apparmor-profile >"$profile" 2>/dev/null || [[ ! -s "$profile" ]]; then
    echo "    (couldn't write the AppArmor profile for Chromium; see docs/guide/getting-started.md)"
  elif ! quiet_soft sudo install -m 644 -o root -g root "$profile" /etc/apparmor.d/factory-flow-chromium; then
    echo "    (couldn't install the AppArmor profile for Chromium; see docs/guide/getting-started.md)"
  else
    quiet_soft sudo apparmor_parser -r /etc/apparmor.d/factory-flow-chromium ||
      echo "    (the AppArmor profile for Chromium didn't load; see docs/guide/getting-started.md)"
  fi
  rm -f "$profile"
fi

# The office keeps its data (floors, workers, boards) in ~/factory-flow and
# clones projects into ~/workspace/<owner>/<repo>. It starts with no project: its elevator
# lists every repository the GitHub token can see, and cloning one makes it the first floor.
OFFICE_HOME="$HOME/factory-flow"
WORKSPACE="$HOME/workspace"
mkdir -p "$WORKSPACE"
# Offices provisioned before that ran in one project's checkout, with their data in it: they carry
# on there, so nobody loses their floors. That project can be taken off in the elevator.
LEGACY_DIR=""
if [[ -f /etc/factory-flow/dir ]]; then
  legacy=$(cat /etc/factory-flow/dir)
  [[ -f "$legacy/.factory-flow/config.json" ]] && LEGACY_DIR="$legacy"
fi
if [[ -n "$LEGACY_DIR" ]]; then
  step "Keeping the office in $LEGACY_DIR (its floors are there)"
  RUN_DIR="$LEGACY_DIR"
  OFFICE_ARGS="$LEGACY_DIR "
else
  RUN_DIR="$HOME"
  OFFICE_ARGS=""
  setup_args=()
  # Once: after that, the folder is the admins' to move in ⚙️ Settings.
  [[ -f "$OFFICE_HOME/.factory-flow/projects-folder.json" ]] || setup_args+=(--projects "$WORKSPACE")
  [[ -n "${PROJECT_REPO:-}" ]] && setup_args+=(--project "$PROJECT_REPO")
  if [[ ${#setup_args[@]} -gt 0 ]]; then
    step "Setting up the office${PROJECT_REPO:+: cloning $PROJECT_REPO as a floor}"
    # It won't touch a running office's floors (the service restarts below anyway).
    sudo systemctl stop factory-flow >/dev/null 2>&1 || true
    node /opt/factory-flow/bin/factory-flow.js setup "${setup_args[@]}" </dev/null ||
      echo "    (carrying on: add projects from the office's elevator)"
  fi
  sudo rm -f /etc/factory-flow/dir
fi
echo "$OFFICE_HOME" | sudo tee /etc/factory-flow/home >/dev/null
[[ -n "$LEGACY_DIR" ]] && echo "$LEGACY_DIR" | sudo tee /etc/factory-flow/dir >/dev/null

# Only the owner reaches this box, over SSH as its own user with a plain `ssh -L`
# tunnel (see deploy/aws.sh): there is no restricted tunnel user anymore, so nothing
# here manages extra keys, helpers or sshd rules for one.
step "Installing the factory-flow service (restarts itself if it ever crashes)"
unit=$(mktemp)
cat >"$unit" <<UNIT
[Unit]
Description=Factory Flow
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$RUN_DIR
EnvironmentFile=/etc/factory-flow/env
Environment=HOME=$HOME
Environment=FACTORY_FLOW_HOME=$OFFICE_HOME
# The folder Chromium was downloaded into, and the AppArmor profile above names.
Environment=FACTORY_FLOW_BROWSERS_PATH=$BROWSERS
Environment=SHELL=/bin/bash
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Lets the office upgrade itself from its UI: it builds the new version, then exits, and
# Restart=always brings it back up on that version.
Environment=FACTORY_FLOW_SELF_UPDATE=1
# Loopback only: the office is reached through an SSH tunnel, never from the internet.
ExecStart=/usr/bin/node /opt/factory-flow/bin/factory-flow.js ${OFFICE_ARGS}--host 127.0.0.1 --port 4700
Restart=always
RestartSec=3
# Stopping or restarting the office stops the office, not its workers: their terminals run in a
# process of their own that the next office picks back up. The default, control-group, would stop
# every worker mid-task on each upgrade.
KillMode=process
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 644 "$unit" /etc/systemd/system/factory-flow.service
rm -f "$unit"
sudo systemctl daemon-reload
sudo systemctl enable factory-flow >/dev/null 2>&1
sudo systemctl restart factory-flow

step "Done"
