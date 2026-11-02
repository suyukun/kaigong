# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Keep a Changelog sections stay empty until there is something to record. -->

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.2.0] - 2026-11-02

Rename release: **specgate is now kaigong** (开工 — the kickoff). Same kit, same
files, new name. The rename and everything else in this release came out of the
P16 adversarial field test: the "teaching" worked (documents carry the system,
new sessions and low-tier models learn it), but the "truncheon" did not exist —
two adversarial rounds walked straight past the checker and it printed PASS.
v0.2.0 fixes what that experiment measured, at the moment migration cost is at
its lifetime minimum (no external users yet).

### Changed

- **Renamed to `kaigong`.** npm package `kaigong` (bare name; the old
  `@smashupcn/specgate` is deprecated and points here), CLI bin `kaigong`,
  repository `github.com/suyukun/kaigong`. Install with `npm i -g kaigong` or
  try it with `npx kaigong`. Every user-visible string — help texts, findings,
  template commands, README / INSTALL — now says kaigong.
- **Compatibility kept on purpose:** the `.specgate-manifest.json` manifest
  file name is unchanged, so the ten projects already onboarded keep a working
  uninstall ledger; existing AGENTS.md files need no edit (the stale-template
  comparison is version-based, not name-based).

### Added

- **check: kickoff blind-spot assertion.** When a repository holds source files
  (heuristic extensions; `node_modules`/`.git`/`docs`/`dist`/`build` excluded)
  while `docs/plans/` holds no actual gate doc (`gate-*.md` / `开工门槛-*.md`,
  template and example copies excluded) and the stage is S0–S3, check now
  reports one finding titled with **kickoff** — the exact hole the P16
  adversarial rounds walked through (code shipped with no batch spec at all,
  and the checker never looked at the code side).
- **check: stage dead-water assertion (advisory).** Stage S0 plus a runnable
  main-flow signal (`package.json` `bin`/`main`/`scripts.start`, or a
  `Cargo.toml` / `pyproject.toml` at the root) now draws an advisory suggesting
  the move to S1. Stacks on the existing S0 ADR-index advisory; replaces
  nothing.
- **Templates: minimal non-negotiables.** The zh/en AGENTS templates gained a
  section for the moment a user asks to skip the process: the gate doc and the
  check are the two things an agent must keep; everything else is negotiable —
  and whatever gets skipped must be negotiated, never dropped by default.
  Both template headers bump to `template_version: 2` (en/zh equal).

## [0.1.1] - 2026-10-28

Dogfood release. After v0.1.0 shipped we put it to work onboarding our own
fifteen internal projects to specgate, and that run surfaced four fixes —
this patch is entirely driven by them. The default path is unchanged unless
you opt in: no flag, byte-identical behavior.

### Added

- **`--lang zh` — Chinese template set.** `specgate init --lang zh` and `specgate check --lang zh`
  (default `en`; the default path behaves exactly as before). The Chinese templates ship in
  `templates/zh/`: AGENTS template, gate-doc template, worked example, and ADR template — a
  general-project distillation of the same methodology, not a translation of any internal file.
- **`check` scans `开工门槛-*.md`.** The NC-OPEN decision-card kickoff scan now matches
  Chinese-named gate docs in `docs/plans/` alongside `gate-*.md`, with the same
  `.template.md` / `.example.md` exclusions and the same exact-`NC-OPEN` card rule.

### Fixed

- **`init` no longer writes a second board over `backlog/`.** When the target directory
  already has a `backlog/` directory (the backlog.md CLI), the plain `docs/BACKLOG.md` is
  skipped and the run output says so — dogfood onboarding kept producing two competing boards.
- **`templates/adr-template.md` actually ships.** v0.1.0 fell back to an in-code copy because
  the file was missing from the package; the real file is packed now, and the Chinese set
  carries its own counterpart.

## [0.1.0] - 2026-10-28

First public release of specgate: stage-aware governance for repositories AI agents
work in. Everything the kit creates is plain markdown that stays in your repository.

### Added

- **Five-document governance kit.** A gate doc (spec) template in `docs/plans/`, an ADR
  decision log in `docs/adr/`, a task board, an architecture doc, and a design spec —
  installed by stage signal (S0 → S3), not on a schedule. See "Five documents, added by
  signals" in the README.
- **`AGENTS.md` scaffold.** Generated from `templates/AGENTS.template.md` with you, not
  for you; carries the single stage marker line the check reads.
- **`specgate init` command.** Add-only scaffolding: it never modifies an existing file.
  Collisions are listed as `exists, untouched` for you to decide. `--adopt` brings an
  existing repository under the kit without rewriting its own `AGENTS.md`, board, or
  decision directory. Agent pointer files (Cursor, GitHub Copilot, Windsurf) are only
  written after you approve them — ask-first, or explicitly with `--yes`.
- **`specgate check` command.** Governance assertions against the stage marker, printing
  all findings at once, each as a `where` / `expected` / `fix` triple with a copyable
  next command. Statuses: PASS / WARN / FAIL / SKIP. Exit codes: `0` ok (check:
  PASS/WARN/SKIP), `1` check FAIL under `--strict`, `2` usage error. Parameterization:
  `--docs-dir`, `--adr-subdir`. CRLF-tolerant. Writes nothing.
- **Two agent skills.** `skills/rose-bootstrap/SKILL.md` (scaffold the governance docs for
  new and existing repositories) and `skills/rose-handoff/SKILL.md` (write a handoff when
  a session ends, read it when the next begins, under `handoffs/`).
- **Worked example batch.** `templates/gate-doc.example.md` ships a fully filled batch —
  decision cards answered, converge steps passed — for reference only.
- **Agent-facing install guide.** `INSTALL.md`, written for the installing agent under the
  same ask-first rules.
- **Zero runtime dependencies.** Node.js >= 18, no network calls beyond the npm download.

### Known issues

- **M-batch wording contradiction.** Symptom: the gate-doc template says an M batch fills sections A and D only, but the pre-dispatch checklist mentions the C1 task table. Trigger: writing your first M gate doc. Workaround: fill a minimal C1 (one row per task); template fix lands in v0.2.
- **Placeholders are advisory.** Symptom: specgate check passes even when AGENTS.md still contains un-filled slots. Trigger: skipping the post-init review step. Workaround: search for the placeholder markers before your first dispatch; a checker lands in v0.2.

