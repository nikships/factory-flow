# Factory Flow guide

Factory Flow is a local workspace where one owner hires Droid workers and works in their live terminals. Every project is a floor backed by its existing checkout. The Mac app opens the companion window directly, and any browser can open the same companion at `/dashboard` (`/` redirects there). Local access needs no pairing. Remote browsers and the Android app use the office's pairing controls.

Install the [Mac app release](getting-started.md#the-mac-app) for production use. Developers can [clone and run the source](development.md).

## Chapters

- **[Getting started](getting-started.md)**: Requirements, installing the Mac app, running a developer checkout, and network access.
- **[Features](features.md)**: What's inside: floors, workers, threads and terminals, the Factory window, Boards, Mission Control, the Whiteboard and more.
- **[Controls](controls.md)**: Companion workspace shortcuts and terminal controls.
- **[Factory Flow for Android](android.md)**: The phone and tablet companion for terminals, prompts and the Whiteboard.
- **[Models and prompts](models-and-prompts.md)**: Choosing models, Droid CLI configuration, subscriptions and customizing prompts.
- **[Deployment](deployment.md)**: Hosting developer checkouts remotely on AWS EC2 or a VPS.
- **[How it works](how-it-works.md)**: Subsystems, status hooks, worktrees, PTYs and `.factory-flow/` state.
- **[External workers over Tailscale](remote-workers.md)**: Letting an outside bot join as a worker, with the [remote MCP reference](remote-mcp.md) its author needs.
- **[Worker label endpoints](worker-label-endpoints.md)**: Using an OpenAI-compatible endpoint for worker labels.
- **[Security notes](security.md)**: Authentication model, LAN tokens, device tokens and proxies.
- **[Development](development.md)**: Developing from source, isolated verification and releases.

## Design specs

The implemented specs in [`docs/`](..) describe each larger area: [single owner](../single-owner.md), [Factory](../factory.md), [Linear](../linear.md), [Whiteboard](../whiteboard.md), [Setup and Subscriptions](../subscriptions.md), [Office MCP](../office-mcp.md) and [Mission Control](../mission-control.md).

## License

[MIT](../../LICENSE)
