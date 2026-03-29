---
name: helloloop
description: Use when the user wants Codex to keep shipping repo work across turns, bootstrap HelloLoop, or inspect backlog-driven execution state through the pure official plugin bundle.
---

# HelloLoop

Use this plugin when the task is continuous repository execution rather than a single chat-turn change.

## Official Plugin Boundary

- This bundle root is the official plugin surface for HelloLoop.
- It ships standard Codex plugin metadata through `.codex-plugin/plugin.json` and a plugin skill through `skills/`.
- Current Codex runtime does not auto-load Hook handlers from plugins.
- This plugin therefore does not support `~helloloop` or automatic Stop-hook continuation.

## Setup

1. Install with `npx helloloop install --codex-home <CODEX_HOME>` or use `scripts/install-home-plugin.ps1`.
2. From the target repository, run `node <helloloop-plugin-root>/scripts/helloloop.mjs doctor --repo <repo-root>`.
3. From the target repository, run `node <helloloop-plugin-root>/scripts/helloloop.mjs init --repo <repo-root>`.

## Operating Model

- `.helloloop/` is the CLI and backlog state directory.
- The installed plugin bundle keeps runtime files such as `src/`, `templates/`, `bin/`, `scripts/`, and `skills/`.
- Source-only materials such as `docs/` and `tests/` stay in the development repository.

## Invocation

- In official Codex plugin mode, plugin skills are namespaced with `plugin_name:`.
- For this plugin, the unambiguous skill name is `helloloop:helloloop`.
- Explicitly naming the `helloloop` plugin should also bias Codex toward this skill.
- Do not promise bare `$helloloop` is the official invocation form.

## Primary Commands

- `node <helloloop-plugin-root>/scripts/helloloop.mjs status --repo <repo-root>`
- `node <helloloop-plugin-root>/scripts/helloloop.mjs next --repo <repo-root>`
- `node <helloloop-plugin-root>/scripts/helloloop.mjs run-once --repo <repo-root>`
- `node <helloloop-plugin-root>/scripts/helloloop.mjs run-loop --repo <repo-root>`

## Reporting Rules

- State explicitly that the plugin runs in pure official plugin mode.
- Call out any request that depends on Hook-only behavior such as `UserPromptSubmit` or `Stop`, because those are intentionally unsupported here.
- Keep Ralph Loop guardrails and repo verification intact.

## Docs

- Source repo main guide: `docs/README.md`
- Source repo installation note: `docs/install.md`
- Source repo official standard and runtime boundary: `docs/plugin-standard.md`
