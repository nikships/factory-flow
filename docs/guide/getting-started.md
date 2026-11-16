# Getting started

## Requirements

For the production Mac app:

- **macOS 14 (Sonoma) or later on Apple silicon.** The app is arm64-only and includes its own Node runtime. Every Apple M-series tier is supported.
- The **[Droid CLI](https://docs.factory.ai/cli/getting-started/quickstart)** (`droid`), Factory's coding agent, signed in to a Factory account as the user that runs the office. Every worker is a Droid session. You don't need it beforehand: when it's missing or signed out, the office opens [the welcome](#the-welcome), which installs it and runs its sign-in, where you sign in to Factory or create an account.
- **Optional: a Claude or ChatGPT subscription.** On a Mac, workers can run on the Claude or ChatGPT plan you already pay for (and a few others) through [DroidProxy](https://github.com/nikships/droidproxy), a small menu-bar app the office installs and drives for you (see [Subscriptions](models-and-prompts.md#subscriptions)).
- **git**, plus the **GitHub CLI** (`gh`) logged in (`gh auth login`) for GitHub projects' issue and PR boards, and the **GitLab CLI** (`glab`) logged in (`glab auth login`) for GitLab projects. A GitLab floor's PR board shows its merge requests, and its workers open merge requests with `glab`. Self-managed GitLab instances work once `glab auth login --hostname <host>` has signed in to them.
- **Chromium**, for the Whiteboard's renderer: about 100 MB to download and 200 MB on disk, downloaded for you (see [Chromium for the Whiteboard](#chromium-for-the-whiteboard)). The office runs without it.
- `curl` is optional. The status hooks use it when it's there and fall back to Node when it isn't.

Developer checkouts also need **Node.js 20+** and npm. The source can run on macOS, Linux and Windows, but those checkouts are not supported production installations.

## Install & run

**The Mac app release is the only supported production install.** Download `Factory-Flow-<version>-arm64.dmg` from the [latest release](https://github.com/nikships/factory-flow/releases/latest), open it, and drag **Factory Flow** into Applications. Launch the app to start your office. It keeps itself up to date; see [The Mac app](#the-mac-app) for first launch, logs and updates.

Command-line installers and standalone server release tarballs are no longer provided or supported. Developers can clone the repository and run or modify it themselves; see [Development](development.md).

### Running a developer checkout

To run the built source without Vite:

```bash
git clone https://github.com/nikships/factory-flow.git
cd factory-flow
npm ci              # builds the client, server and desktop app
npm run start       # runs the built office from this checkout
```

The command examples below use `factory-flow` as shorthand for `node bin/factory-flow.js` from the checkout. They are developer tools, not a production installation method.

The first time the checkout starts in a terminal, it walks you through setting up before it opens:

1. **Which folder your projects are in.** It suggests a code folder you already have (`~/Workspace`, `~/code`, `~/repos`…), else your home folder. The office looks for git projects in it and its subfolders, and never clones or copies anything.
2. **Your first project.** It lists the git projects it found, most recently active first. Pick one by number, type its full path, or type a word to search. It becomes the first floor, and you can add more the same way.

Press Enter to skip any step: the floor switcher in the office asks for your first project too. Run `factory-flow setup` to go through it again while the office is stopped, or `factory-flow setup --projects ~/Workspace --project ~/Workspace/my-project` to do the same without questions, from a script.

It prints the URL for this machine's browser, which needs no login, and — unless bound to loopback — a join URL and QR code for other devices on your Wi-Fi (see [Access](#access) below).

The office keeps its data in `~/factory-flow` (`--home` or `FACTORY_FLOW_HOME` to move it) and opens your existing checkouts as floors where they are. To make it look for them in another folder, like `~/Workspace`, pick the **Workspace folder** in ⚙️ Settings → **Office & floors**, or with **Change folder** in the Add floor panel (or start with `--projects` or `FACTORY_FLOW_PROJECTS`). The folder has to exist. Floors you already have stay where they are when it moves. The list of floors is `~/factory-flow/.factory-flow/floors.json`. Each floor keeps its workers, Whiteboards and worktrees in its own checkout's `.factory-flow/`.

Every setting the office reads from the environment is listed, with its default, in [`.env.example`](../../.env.example). The office doesn't load `.env` files: export the settings in the shell that starts it, or set them as `Environment=` lines in a developer checkout's systemd unit. A command-line flag wins over its environment variable.

You can also start the office in a project, `factory-flow ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.factory-flow` as it did before there were floors. An office that already ran in a project carries on in it when you start `factory-flow` there again. You can take that project off the building in the floor switcher like any other floor.

### Chromium for the Whiteboard

The Whiteboard draws its cards with a headless Chromium, driven by `playwright-core` and pinned to the revision that release expects. Its sandbox is always on: the office never starts it with `--no-sandbox`. Two things have to be in place, and neither stops the office from starting. If one is missing, the board says renders are unavailable and why.

- **The browser** (about 100 MB to download, 200 MB on disk) goes into one folder every install and launch shares: `~/Library/Caches/factory-flow/browsers` on macOS, `$XDG_CACHE_HOME/factory-flow/browsers` (default `~/.cache/factory-flow/browsers`) on Linux, and `%LOCALAPPDATA%\factory-flow\browsers` on Windows. `FACTORY_FLOW_BROWSERS_PATH` moves it. It needs no admin rights. The Mac app downloads it in the background at launch and again after an update that pins a new revision (`~/Library/Logs/Factory Flow/browser.log`). Developer checkouts can run `factory-flow browser install` to download it by hand and `factory-flow browser status` to check whether it's there. The office also downloads it on first use; a failed download leaves the office running and reports why renders are unavailable.
- **On Linux developer checkouts, its system libraries** need admin rights. As an admin, run `sudo node <checkout>/node_modules/playwright-core/cli.js install-deps chromium` (the error the board shows names the exact command for your checkout). `deploy/provision.sh` does this on the AWS box. Playwright has library lists for Ubuntu 22.04 and 24.04 and Debian 12 and 13, on x64 and arm64. macOS (Intel and Apple Silicon) and Windows 10 and 11 on x64 need nothing more. These source platforms are not production install targets.
- **On Ubuntu 23.10 and later**, AppArmor stops unprivileged programs from using the user namespaces Chromium's sandbox needs, and it fails with *No usable sandbox*. With admin rights, `factory-flow browser apparmor-profile | sudo tee /etc/apparmor.d/factory-flow-chromium` followed by `sudo apparmor_parser -r /etc/apparmor.d/factory-flow-chromium` installs a profile for that browser alone. `deploy/provision.sh` installs it on the AWS box.

### The Mac app

On an Apple silicon Mac running macOS 14 or later, **Factory Flow.app** does all of this for you: it starts the office, opens its companion window, and updates itself. Download `Factory-Flow-<version>-arm64.dmg` from the [latest release](https://github.com/nikships/factory-flow/releases/latest), open it and drag **Factory Flow** into Applications. It's signed with a Developer ID and notarized by Apple, so it opens without a warning. It needs no Node.js of its own (the office runs on the app's built-in Node), but it does need `git` and, for the GitHub boards, `gh` signed in (`gh auth login`). It installs and signs in `droid` itself, in [the welcome](#the-welcome).

- **Requirements, checked at every launch.** macOS 14+ and arm64. Startup failures show a dialog and write `startup.log`. `Factory Flow --startup-check --user-data-dir=<folder>` runs the requirements check without opening a window.
- **The first launch** asks where your office lives: `~/factory-flow` (what `factory-flow` opens with no folder), or a folder you pick. Pick a folder an office already ran in to carry on with its floors and workers. **Office → Change Office Folder…** switches later. The app remembers the choice in `~/Library/Application Support/com.nikships.factory-flow/settings.json`, which can also set `"port"` (default 4700).
- **Starting.** The app starts the office with `factory-flow --home <folder>`, or `factory-flow <folder>` for a checkout an office was started in as a project, on port 4700, and shows it once it answers. If an office already answers on that port (a `factory-flow` in a terminal, say), the app opens that one instead of starting a second. If something else holds the port, it takes the next free one. The office and its workers get your login shell's environment, as they would from a terminal, rather than the bare one macOS gives apps: its `PATH`, and everything else your shell profile exports (`JAVA_HOME`, API keys, `LANG`…). Without a locale from anywhere, they get `LANG=en_US.UTF-8`.
- **Opened from the disk image or Downloads**, the app offers to move itself into Applications. macOS runs it from a read-only copy there, so it can't update itself, and workers' terminals stop working once the disk image is ejected.
- **Window.** The companion opens in a resizable ordinary Electron window. View → Toggle Full Screen changes it. Links outside the office open in your browser.
- **The menu bar icon.** Closing the window or Command + Q leaves workers running behind the tray, a monochrome Factory glyph that follows the light or dark menu bar. Command + W closes the focused pane; Command + Shift + W opens its send-home confirmation. The tray shows worker and device counts and offers Open Office, Restart Office, Check for Updates, Quit Factory Flow and Quit and Stop Workers.
- **Quitting** (**Quit Factory Flow** in the icon's menu, **Factory Flow → Quit Factory Flow** or Option+Cmd+Q in the window, the Dock's **Quit**, logging out, shutting down or installing an update) works like restarting the office: workers keep running in their terminal host, and opening the app again within 30 minutes picks them back up. **Quit and Stop Workers…** asks first, then ends the workers' terminals with the office. An office the app didn't start (one already running on its port) keeps running when the app quits. The office's output goes to `~/Library/Logs/Factory Flow/office.log` (**Office → Show Office Log**).
- **Isolated packaged checks.** `--user-data-dir=<folder>` uses separate settings and logs and connects only to an already-running office on its configured spare port. It never starts the owner's daemon, moves the app or checks updates. Use a properly signed app without changing its bundle.
- **Updates.** Every release on `main` comes with the app (see [Releases](development.md#releases)). The app checks for a newer one at launch and every 30 minutes. When there is one, a single **Software Update** sheet opens on the office window: **Install and Restart** downloads it with a progress bar right there (**Cancel** or Esc stops the download), then the app restarts into it. Restarting keeps your workers running. **Later** closes the sheet without downloading anything, and the background checks don't offer that version again until the next launch. **Factory Flow → Check for Updates…** checks now and opens the same sheet, which says so when you're up to date or the check failed (with **Try Again**). It reads the public releases of `nikships/factory-flow`, so it needs no GitHub login. What it did is in `~/Library/Logs/Factory Flow/updates.log`.

### The welcome

An office whose Droid isn't installed or signed in opens the welcome by itself once the office has loaded, in the Mac app and in a browser alike. It has four steps down its side, each ticked once done, and every step also ticks when you finish it somewhere else (in another tab, in a terminal, or in DroidProxy's own window):

1. **Droid.** **Install** downloads the newest Droid from `downloads.factory.ai`, checks its SHA-256 and, on macOS, that it is signed by Factory, and puts it in `~/.local/bin/droid`, where Factory's own installer puts it. Where the office can't install it (Windows, another `--agent` command), the step shows the command to run instead and **Check again**.
2. **Factory account.** **Sign in** runs Droid's own sign-in and shows its code. **Open sign-in page** opens Factory's page with the code filled in, where you sign in or create an account. The step reads *Signed in as …* when Droid has the account.
3. **Subscriptions** (Macs only). **Connect** Claude or ChatGPT, or another provider under **More**. The office installs DroidProxy if it has to, starts it in the background, and opens the provider's sign-in in your browser (or shows a device code). Once an account is connected, its models go into Droid and the step shows how much of each usage window is left. **Skip** leaves workers on Factory's own models; ⚙️ Settings → **Connections** connects one later.
4. **Ready.** Pick the model new workers start on (the best one that can run is already picked) and **Start**. It becomes the office's Default worker (⚙️ Settings → **Models**).

Until you press **Start**, or close it once Droid is signed in, it opens again at its next step whenever the office loads, so a reload or a restart halfway through doesn't lose the last steps. An office that already worked never sees it. The ☰ menu opens it again at any time. ⚙️ Settings → **Connections** → **Droid** shows the version, updates it, and signs it in again.

### Open the running office in a browser app window

In Chrome or Edge, open an already-running office and choose **Install** in the address bar, or **⋮ → Cast, save and share → Install page as app**. This only creates a browser window shortcut, not a Factory Flow installation. The Mac app (or a developer checkout) still needs to be running. The shortcut has no offline mode and needs HTTPS with a certificate your browser trusts, or `localhost` (including an SSH tunnel).

### Access

There are no office passwords, accounts, sessions or login pages. Each start mints a random LAN token, kept in memory and never written to disk; starting the office prints the join URL and a QR code of it in the terminal. Requests from the office's own machine (loopback) connect freely with no token. Every other HTTP request and WebSocket connection must carry the token as `?t=<token>`; a missing or wrong token is refused.

To connect another browser on your network, use the printed link or scan the terminal's QR code: that is the join URL, token included. The token changes on every start, so after a restart, scan the new code. To keep the office to this machine only, start with `--host 127.0.0.1`: there is then no join URL at all.

A paired phone (see [Factory Flow for Android](android.md)) carries a **device token** instead. It opens the office the way the LAN token does, for every page, API and the WebSocket, but it keeps working across restarts until you forget the phone. The phone sends it as `Authorization: Bearer <token>` (or `?d=<token>`). The office keeps only its SHA-256, in its own `.factory-flow/devices.json`. A device token that was forgotten is refused everywhere, even on loopback, so the phone knows to pair again.

An office that ran before this had a shared password and per-person accounts. Those are gone: the old `accounts.json` is left unread on disk (in the office's `.factory-flow/`, next to `config.json`), and so is the old `chat.jsonl`. Delete them yourself if you want them gone; the office never reads, writes or serves them.

```
factory-flow [dir] [options]
factory-flow setup | prune | browser <install|status|path|apparmor-profile>

      --home <dir>        Where the office keeps its data without a [dir] (default ~/factory-flow)
      --projects <dir>    Where the office looks for existing git checkouts to add as floors (default a
                          code folder in your home folder, else the home folder; also settable from ⚙️ Settings → **Office & floors**)
  -p, --port <n>          Port (default 4700, env PORT)
  -H, --host <addr>       Bind address (default 0.0.0.0; 127.0.0.1 keeps the office on this machine)
      --agent <cmd>       The Droid command (default "droid", env FACTORY_FLOW_AGENT)
      --agent-args <str>  Extra args for Droid, e.g. "--auto medium"
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --max-workers <n>   Run at most n workers at once, across every floor (env FACTORY_FLOW_MAX_WORKERS)
  -h, --help              Show help

factory-flow setup [--projects <dir>] [--project <dir>]... [--home <dir>]

  The first-start walkthrough again: the workspace folder, and which of the
  git checkouts in it are floors. With --projects / --project it asks nothing.
  Run it while the office is stopped.

factory-flow prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .factory-flow/worktrees/ and their
  flow/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given. Only workers recorded by the office are protected; outside processes are not
  checked. A worker across several projects has worktrees of them in its
  own floor's workspace: prune each project to clear those out.
```
