---
name: agent-knip
description: Scan AI coding agent data, review cleanup candidates, move explicitly approved data into agent-knip's recoverable quarantine, or restore quarantined data. Use when asked to inspect or clean up leftover agent data, or restore a previous cleanup.
license: MIT
compatibility: Requires Node.js 22+ and npx. The agent-knip CLI must support the requested operation.
---

# agent-knip

Use `npx agent-knip` to inspect AI coding agent data and, when requested, move selected paths into a recoverable quarantine. The tool does not uninstall agents or prove that an agent is unused.

## Scan

1. Run `npx agent-knip scan`. To focus on one agent, add `--agent <id>` using an ID listed by `npx agent-knip --help`.
2. Explain that a cleanup candidate only passed the tool's checks; it is not proof that the agent is unused or that the data has no value. No install evidence does not mean uninstalled.
3. Use `--explain` when the user asks why a path was included or retained. Do not inspect or print credential contents.

## Quarantine data

1. Require a single agent ID. Run `npx agent-knip prune --agent <id>` first; this previews paths and does not move them.
2. Summarize the exact preview, including paths to be moved and any paths retained. Ask for confirmation before proceeding unless the user has already explicitly approved moving those exact paths.
3. After approval, run `npx agent-knip prune --agent <id> --yes`.
4. Report the outcome and explain that moved data is stored under `~/.agent-knip/trash` and can be restored with `npx agent-knip restore --all`.

Never run multiple agents in one prune command. Do not use `--force-recent` unless the user specifically asks to include paths modified in the last 7 days; explain that it bypasses only the recent-modification check, not other protections.

## Restore data

1. Run `npx agent-knip restore --list` to show quarantined batches.
2. Run `npx agent-knip restore --all` only when the user asks to restore. The CLI refuses to overwrite existing paths; report any conflicts without deleting or replacing either copy.

## Limits

- Do not claim that agent-knip uninstalls an agent, detects every installation, or identifies every credential.
- Do not replace the CLI's safety checks with manual file deletion or movement.
- If the installed CLI does not support the requested command or option, stop and explain the version limitation rather than substituting another cleanup method.
