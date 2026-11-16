# Docs

- `guide/` holds user-facing chapters; update the matching bullet in `guide/how-it-works.md` whenever subsystem behavior or `.factory-flow/` state changes, and put repo-editing rules in the nearest `AGENTS.md` instead.
- Top-level `docs/*.md` files are implemented design specs (indexed in the root `AGENTS.md` and local `AGENTS.md` pointers); keep a spec current when changing its area.
- Keep command blocks in `guide/` aligned with `package.json` scripts and CLI `--help`.
- The root `README.md` embeds real screenshots from `assets/readme/`. Capture them from a `flow-clone` or `verify-factory-flow` run on an isolated port, and replace them in a dedicated change, separate from text edits.
