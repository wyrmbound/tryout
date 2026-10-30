# tryout

Timed trials for Claude Code add-ons. Tell Claude *"try this repo for a week"* or *"add the skills from this video for 3 days"*. It checks each add-on, installs it, and records an end date. Before the trial ends, Claude asks whether you want to keep it, extend it, or remove it. If you don't answer, it gets removed automatically.

## Install

```bash
claude plugin marketplace add wyrmbound/tryout
claude plugin install tryout@tryout
```

Restart Claude Code. Needs Node (which Claude Code already uses) and nothing else.

## Use

Just talk to Claude:

- "Add github.com/someone/cool-plugin as a 2-week trial"
- "Try all the skills from this video for 5 days: <link>"
- "What am I trying right now?"
- "Keep cool-plugin" / "Extend it 3 days" / "Remove it now"

## What it handles

| Add-on | Removed automatically when the trial ends? |
|---|---|
| Plugins (`claude plugin install`) | Yes. The marketplace is removed too if the trial added it and nothing else uses it. |
| Skill folders in `.claude/skills/` | Yes |
| MCP servers (`claude mcp add`) | Yes |
| Anything that installs system software (npm -g, pip, binaries) | No. You get a reminder with the removal steps. |

Only things that were installed as a trial get removed. Anything you already had is never touched.

## How it works

- `skills/tryout/SKILL.md` tells Claude how to vet, install and record a trial.
- `skills/tryout/tryout.mjs` keeps the trial log at `~/.claude/tryout/trials.json` (or under `$CLAUDE_CONFIG_DIR`).
- A `SessionStart` hook runs `tryout.mjs check` every time a session starts. It removes trials that have ended and tells Claude about trials ending soon (within 2 days, or within half the trial length for short trials).

Reminders only happen when a Claude Code session starts. A trial that ends while Claude Code is closed is removed at the next session start.

You can run the CLI directly with `node skills/tryout/tryout.mjs` (no arguments shows help).

## Develop

```bash
node --test
claude --plugin-dir .
```

MIT licensed.
