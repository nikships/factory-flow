# Features

## Workspace

The Mac app opens the companion window straight onto `/dashboard`, and a browser shows the same workspace. Open up to eight panes with a worker's conversation thread or live terminal in each. Auto layout follows active work; manual layouts, divider ratios, selected workers and drafts stay with each floor. Closing a pane never dismisses its worker.

**All workers** lists workers across every floor and Mission Control. Search and filter by floor, status, task, branch or model. The sidebar groups leads and subagents; questions and unseen completions stay visible. The header shows every floor as a numbered tab, with the ones that need you first and the rest behind **+N more** (⌘K).

## Floors and workers

A floor is a project checkout or a plain folder. Adding a floor never clones or moves it. Home is always available. Git floors offer branches, worktrees and forge state; plain folders do not inherit a parent repository.

Use **Hire Droid** to assign a task, choose a model and reasoning effort, and optionally create an isolated worktree. Worktree setup copies configured files and runs the repository's setup command before the agent starts. Multi-repository tasks can include other open floors. **Shell** starts a login shell without a model or worktree. Workers sit in numbered slots (desks 1–16, then overflow slots), which is the order the companions and Android list them in.

Workers keep their Droid session ids and terminal scrollback across server restarts. Their PTYs run in a detached host. **Fork** creates an independent conversation twin between turns. Git forks receive their own worktree at the source commit with local changes; plain-folder forks share the original folder. **Send home** asks what to retain and refuses unsafe deletion.

## Threads, terminals and changes

A Thread shows prompts, assistant responses, tool activity, pictures, queued messages and questions. Raw TTY gives direct keyboard access to the same live terminal. Permission prompts stay with the owner.

Prompt history retains the last 50 agent prompts in this browser. Pasted or dropped PNG, JPEG, GIF and WebP images attach to agent prompts, with up to ten images of 25 MiB each. Terminal drops become file paths in the worker's checkout.

**Changes** shows a worker's changed files and diff, with a separate tab per repository. Commit, discard and pull-request actions act on that checkout and keep worktree ownership checks.

## The Factory window

The Factory glyph at the left of the header opens one window with five tabs. Each tab also has a `Factory: …` action in the ⌘K palette's Actions group, beside one `Boards: …` action per Boards tab, and the window remembers its last tab. It needs a Factory API key from **Settings → Connections**.

- **Computers**: Droid Computers and the Environments they start from. Details, metrics, create, restart or wake, delete, and computer secrets.
- **AutoWiki**: the selected floor's wiki, with page search, versions, generation (after a cost confirmation), visibility, download and deletion.
- **Files**: the floor's checkout. Docs or all files, ⌘P go-to-file, content search, and Markdown preview, edit and split modes with conflict-aware saves.
- **Sessions**: a read-only view of running and pending Factory sessions, today's and seven-day credits, top sessions and recent pull requests they opened or merged.
- **CI**: this floor's Droid workflows from Factory's GitHub integration, their runs and workflow pull requests, with Add, Change and Remove (Factory opens a pull request in the floor's repository) and Rescan. A floor without a GitHub origin shows that instead.

Factory cloud workers hire onto a Factory computer and show up in the sidebar beside local workers, with a Thread but no terminal.

## Boards

**Boards** (⌘I, or the Boards button) opens one window for the floor's forge and trackers: Issues, Pull requests, Pipelines, Linear and Jira. It remembers the last tab per floor. The button's badge counts pull requests with failing checks or requested changes plus workflows whose latest run failed. From any card you can hand an issue, pull request or ticket to a worker.

Connect Linear (an API key) and Jira (a site, email and token) in **Settings → Connections**. GitHub and GitLab boards use the `gh` and `glab` CLIs you are already signed in to.

## Teams and Mission Control

Workers can hire subagents through Office MCP, inspect their work, send steering messages, answer questions, review results and integrate commits. Leads own their subagents' completions; permission prompts still belong to the owner.

Independent local workers can send peer tells, questions and handoffs on their floor. The inbox queues messages while the target is starting, awaiting input or being typed into. Urgent messages may cancel a busy turn with Escape, never approve a permission.

Mission Control holds the Orchestrator and external Tailscale bots. They coordinate teams across floors without occupying a floor slot. The Gemini Decisions connection and the optional inter-agent noise gate live in **Settings → Connections**.

## The Whiteboard

Each floor has a Whiteboard (⌘B) where workers put Markdown, images, videos and interactive HTML for you to review. Pin comments, add sticky notes and pictures, fill in forms, then tell a worker to look. See [the Whiteboard spec](../whiteboard.md).

## Models, subscriptions and setup

Pick models per worker or set a default in Settings. Connect a Claude or ChatGPT plan through DroidProxy and see what is left of each usage window from the header. The welcome installs and signs in Droid. See [Models and prompts](models-and-prompts.md) and [Getting started](getting-started.md#the-welcome).

## Access and updates

Direct loopback browsers and the Mac window stay available when remote web access is off. Remote and paired browsers are refused, but paired Android phones remain connected. `/open/...` links open workers, floors or Whiteboard cards without carrying credentials. [Android](android.md) pairs by QR code.

The menu bar icon keeps workers running when the Mac window closes, and signed app updates preserve worker terminals. See [Getting started](getting-started.md) and [Controls](controls.md).
