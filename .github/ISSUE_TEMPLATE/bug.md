---
name: Bug report
about: Something the kit does is not what it says or what you expected
title: "short, factual summary"
labels: bug
---

## Description

What happened, in one or two sentences.

## Steps to reproduce

Use the smallest repository you can. Number every step.

1. `npm i -D kaigong` (or note if running from source: `node src/cli.mjs …`)
2. `kaigong init . --stage S0 --owner You --project-name Demo`
3. `kaigong check . --strict`
4. …

## Expected output

What you expected to see, including the exit code if it matters.

## Actual output

Paste the real output. Please include the exit code:

```text
(paste here)
```

## Environment

- kaigong version (`kaigong --version`):
- Node.js version (`node --version`):
- Platform and shell (OS, architecture, terminal):
- Agent tool in use, if the problem involves a skill or pointer file (Claude Code, Codex CLI,
  Gemini CLI, Cursor, GitHub Copilot, Windsurf, other):
- Is the target a git repository: yes / no

## Did the kit change your files?

kaigong is add-only and `check` writes nothing. If an existing file was modified, say which
file and attach `git status --porcelain` — that is the most useful single piece of evidence.
