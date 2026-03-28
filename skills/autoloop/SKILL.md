---
name: autoloop
description: Use when the user wants Codex to keep shipping repo work across turns, bootstrap Autoloop, or inspect backlog-driven execution state through the pure official plugin bundle.
---

# Autoloop

Use this plugin when the task is continuous repository execution rather than a single chat-turn change.

## Official Plugin Boundary

- This bundle root is the official plugin surface for Autoloop.
- It ships standard Codex plugin metadata through `.codex-plugin/plugin.json` and a plugin skill through `skills/`.
- Current Codex runtime does not auto-load Hook handlers from plugins.
- This plugin therefore does not support `~autoloop` or automatic Stop-hook continuation.

## Setup

1. Install this bundle into `$CODEX_HOME/plugins/autoloop` or use `scripts/install-home-plugin.ps1`.
2. From the target repository, run `node <autoloop-plugin-root>/scripts/autoloop.mjs doctor --repo <repo-root>`.
3. From the target repository, run `node <autoloop-plugin-root>/scripts/autoloop.mjs init --repo <repo-root>`.

## Operating Model

- `.helloagents/autoloop/` is the CLI and backlog state directory.
- `src/`, `templates/`, `bin/`, and `tests/` are bundled directly beside the plugin metadata.
- `docs/` contains the standalone plugin documentation.

## Invocation

- In official Codex plugin mode, plugin skills are namespaced with `plugin_name:`.
- For this plugin, the unambiguous skill name is `autoloop:autoloop`.
- Explicitly naming the `autoloop` plugin should also bias Codex toward this skill.
- Do not promise bare `$autoloop` is the official invocation form.

## Primary Commands

- `node <autoloop-plugin-root>/scripts/autoloop.mjs status --repo <repo-root>`
- `node <autoloop-plugin-root>/scripts/autoloop.mjs next --repo <repo-root>`
- `node <autoloop-plugin-root>/scripts/autoloop.mjs run-once --repo <repo-root>`
- `node <autoloop-plugin-root>/scripts/autoloop.mjs run-loop --repo <repo-root>`

## Reporting Rules

- State explicitly that the plugin runs in pure official plugin mode.
- Call out any request that depends on Hook-only behavior such as `UserPromptSubmit` or `Stop`, because those are intentionally unsupported here.
- Keep Ralph Loop guardrails and repo verification intact.

## Docs

- Main guide: `docs/README.md`
- Installation: `docs/install.md`
- Official standard and runtime boundary: `docs/plugin-standard.md`
