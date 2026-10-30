---
name: tryout
description: Use when the user asks to add, install or try a GitHub repo, plugin, skill, MCP server, or "the skills from" a video, post or list; when they mention a trial period for an add-on; or when session context reports tryout trials ending soon or removed.
---

# Tryout

Every add-on the user tries goes on a trial with an end date. When it ends unanswered, the session-start hook removes it. The ledger is the only memory of a trial, so **record every trial the moment it is installed**.

`TRYOUT` below means `node "<this skill's base directory>/tryout.mjs"`. Run it with no arguments for the full syntax.

## Adding something

1. **Collect the links.** For a video, post or page, read its description and transcript (or text) and pull out every GitHub repo, plugin, skill or MCP server it names. Show the list before going on.
2. **Ask once: trial or permanent, and for how long?** Skip the question if the user already said. If it is already installed, it is not a trial: say so and leave it alone.
3. **Vet each one before installing.** Confirm it comes from the official repo or package, not a lookalike. Read its manifest, hooks, scripts and MCP launch command. Report in a line or two: what runs, any network calls, any binaries. Stop and ask if you find downloaded executables, obfuscated code, access to credentials, or unexplained network calls.
4. **Install, then record it right away:**

| What | Install | Record |
|---|---|---|
| Plugin | `claude plugin marketplace add <owner/repo>` (if the marketplace is new), then `claude plugin install <plugin>@<marketplace>` | `TRYOUT add --kind plugin --name <plugin>@<marketplace> --days N --source <url>`, plus `--marketplace <name>` if you added the marketplace, plus `--scope` if not user |
| Skill folder | copy only the skill folder to `~/.claude/skills/<name>/` (project: `.claude/skills/<name>/`) | `TRYOUT add --kind skill --name <name> --path <that folder> --days N --source <url>` |
| MCP server | `claude mcp add ...` | `TRYOUT add --kind mcp --name <server> --scope <scope> --days N --source <url>` |
| Anything that installs system software (npm -g, pip, binaries, runtimes) | tell the user it can't be removed automatically, and install only if they agree | `TRYOUT add --kind manual --name <id> --days N --note "<exact removal steps>"` (gets a reminder only) |

5. Tell the user plugins and MCP servers load in the **next** session, and when each trial ends.

## When context says trials end soon

Ask the user once, early on: keep, extend, or remove each one?

- Keep: `TRYOUT keep <name>` (forgets the trial, uninstalls nothing)
- Extend: `TRYOUT extend <name> --days N`
- Remove now: `TRYOUT remove <name>`

No answer means do nothing: the hook removes it after it ends.

If you're asked "what am I trying?", run `TRYOUT list`.

## Common mistakes

- Installing and forgetting to record: the trial then never expires.
- Recording something that was already installed before the trial: removal would delete something the user already had.
- Removing things by hand instead of with `TRYOUT remove`: the ledger then goes stale.
