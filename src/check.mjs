// check.mjs — `kaigong check`: stage-aware governance audit.
// Ported from governance-stage-check.sh (the authoritative bash source) with
// plugin semantics per 裁决表 v2: findings are WARN by default (exit 0);
// --strict turns them into FAIL (exit 1). All paths parameterized; CRLF/BOM
// in AGENTS.md tolerated. Zero dependencies.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { UsageError, parseArgs, toPosix, templateText, projectNameFromAgents, PKG_ROOT } from './util.mjs';

const BOOL_FLAGS = ['strict', 'help'];

const HELP = `kaigong check — audit project docs against the AGENTS.md stage marker

Usage:
  kaigong check [dir] [options]

Stage marker: the first "<!-- stage: X -->" comment in AGENTS.md.
Allowed: S0 | S1 | S2 | S3 | exempt | frozen | merged:PNN (docs live with the
target project — SKIP).

Per-stage requirements (five-doc kit):
  S0        ADR index docs/adr/README.md (advisory at S0)
  S1 S2 S3  docs/plans container · ADR index · task board (backlog/ dir or
            docs/BACKLOG.md) · architecture current state (docs/architecture/
            or docs/architecture.md, or an "Architecture (current)" / 架构现状
            section in AGENTS.md)
  S2 S3     design spec (root DESIGN.md or a non-empty docs/design/) unless
            "<!-- design: exempt -->" appears in AGENTS.md

Governance assertions (all findings, like the stage checks above):
  kickoff   docs/plans/gate-*.md and 开工门槛-*.md (the shipped template/example
            copies excluded)
            must contain zero open decision cards — ledger table rows whose
            State cell reads exactly "NC-OPEN". Enum definition rows (naming
            NC-OPEN together with NC-RESOLVED) and unfilled <...> example rows
            are teaching text, not cards. Open cards block coding dispatch.
  stale     an AGENTS.md "<!-- template_version: N -->" older than the shipped
            template reports a stale finding with an update hint; your file is
            never edited (an AGENTS.md without the marker is not flagged).
  kickoff+  source code present while docs/plans/ holds no actual gate doc ->
            one kickoff blind-spot finding (stage S0-S3; heuristic source
            extensions, node_modules/.git/docs/dist/build excluded)
  stage     stage S0 plus a runnable entry point (package.json bin/main/
            scripts.start, or Cargo.toml / pyproject.toml at the root) ->
            advisory finding suggesting the move to S1

Options:
  --strict                    Findings fail the run (exit 1). Default: WARN, exit 0.
  --docs-dir <dir>            Docs root (default: docs)
  --lang <en|zh>              Language of the shipped AGENTS template used for
                             the stale comparison (templates/ vs
                             templates/zh/). Default: en.
  --agents-file <file>        Default: AGENTS.md
  --plans-subdir <name>       Default: plans
  --adr-subdir <name>         Default: adr
  --architecture-subdir <n>   Default: architecture
  --design-subdir <name>      Default: design
  --design-file <file>        Root design doc alternative (default: DESIGN.md)
  --board-file <file>         Board markdown inside docs-dir (default: BACKLOG.md)
  --backlog-dir <dir>         Board directory at repo root (default: backlog)
  -h, --help                  Show this help

Exit codes: 0 = PASS / WARN / SKIP · 1 = FAIL (--strict with findings) · 2 = usage error.
The five-doc model, stage signals, and each document's role: see AGENTS.md in
the target project (created by "kaigong init").`;

const STAGE_RE = /<!--\s*stage:\s*([A-Za-z0-9:.-]+)\s*-->/;
const VALID_STAGE = /^(S[0-3]|exempt|frozen|merged:[A-Za-z0-9.-]+)$/;

// AC-1 kickoff blind-spot heuristic: file extensions that say "source code"
// (not docs, not config). Fixed list, lowercase compare.
const CODE_EXTS = new Set(['.py', '.js', '.mjs', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.sh', '.html']);
// Directories a source scan never enters: dependencies, repo metadata, the
// docs tree itself, build output. 'docs' also covers the default --docs-dir.
const CODE_SKIP_DIRS = new Set(['node_modules', '.git', 'docs', 'dist', 'build']);

/** First source file under absDir as a posix relative path, or null.
 * Recursive, read-only, symlink-ignoring; skips CODE_SKIP_DIRS at any depth. */
function findSourceFile(absDir, relParts) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (CODE_SKIP_DIRS.has(e.name)) continue;
      const hit = findSourceFile(join(absDir, e.name), relParts.concat(e.name));
      if (hit !== null) return hit;
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.');
      if (dot !== -1 && CODE_EXTS.has(e.name.slice(dot).toLowerCase())) {
        return relParts.concat(e.name).join('/');
      }
    }
  }
  return null;
}

/** A visible main-flow signal for the stage-S0 dead-water check (AC-2):
 * package.json declaring bin / main / scripts.start, or a Cargo.toml /
 * pyproject.toml at the project root. Returns a where-string, or null. */
function mainflowSignal(dir, has) {
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && typeof pkg.bin === 'object' ? Object.keys(pkg.bin)[0] : null);
      if (typeof bin === 'string' && bin) return 'package.json — declares "bin" (' + bin + ')';
      if (typeof pkg.main === 'string' && pkg.main) return 'package.json — declares "main" (' + pkg.main + ')';
      const start = pkg.scripts && typeof pkg.scripts.start === 'string' ? pkg.scripts.start.trim() : '';
      if (start) return 'package.json — declares "scripts.start" (' + start + ')';
    } catch { /* unparsable package.json: the file markers below still count */ }
  }
  if (has('Cargo.toml')) return 'Cargo.toml — found at the project root';
  if (has('pyproject.toml')) return 'pyproject.toml — found at the project root';
  return null;
}

// A table row's State cell is the open-card marker only when the cell reads
// exactly NC-OPEN (backticks tolerated). "NC-OPEN: soon" in a question cell
// or a prose mention does not match.
const OPEN_STATE_CELL = /^`?NC-OPEN`?$/;
// Unfilled template furniture: a cell still holding a <...> or {{...}}
// placeholder ("Replace every {{...}} and every <...>" — the template's own
// rule). Such rows are examples, not cards.
const PLACEHOLDER_CELL = /<[^<>|]*>|\{\{[^{}|]*\}\}/;

/** Line numbers of open decision cards: ledger table rows whose State cell is exactly "NC-OPEN". */
export function openCardLines(text) {
  const hits = [];
  text.split('\n').forEach((ln, i) => {
    if (!ln.includes('|') || !ln.includes('NC-OPEN')) return; // not a table row / no state
    if (ln.includes('NC-RESOLVED')) return; // state-enum definition row, not an open card
    const cells = ln.split('|').map((c) => c.trim());
    if (!cells.some((c) => OPEN_STATE_CELL.test(c))) return; // State cell must be exactly NC-OPEN
    if (cells.some((c) => PLACEHOLDER_CELL.test(c))) return; // unfilled template example row
    hits.push(i + 1);
  });
  return hits;
}

export function runCheck(argv) {
  argv = argv.map((a) => (a === '-h' ? '--help' : a));
  const { flags, positionals } = parseArgs(argv, BOOL_FLAGS);
  if (flags.help) { console.log(HELP); return 0; }
  if (positionals.length > 1) throw new UsageError('unexpected extra argument: ' + positionals[1] + ' (usage: kaigong check [dir] [options])');
  const dir = resolve(positionals[0] ?? '.');
  if (!existsSync(dir)) throw new UsageError('project directory not found: ' + dir);
  const dirArg = positionals[0];
  const dirName = basename(dir) || dir;

  const lang = flags.lang ?? 'en';
  if (lang !== 'en' && lang !== 'zh') throw new UsageError('invalid --lang ' + JSON.stringify(lang) + ' (expected en | zh)');

  const docsDir = flags['docs-dir'] ?? 'docs';
  const agentsRel = flags['agents-file'] ?? 'AGENTS.md';
  const plansRel = join(docsDir, flags['plans-subdir'] ?? 'plans');
  const adrSub = flags['adr-subdir'] ?? 'adr';
  const adrIndexRel = join(docsDir, adrSub, 'README.md');
  const archRel = join(docsDir, flags['architecture-subdir'] ?? 'architecture');
  const designDirRel = join(docsDir, flags['design-subdir'] ?? 'design');
  const designFileRel = flags['design-file'] ?? 'DESIGN.md';
  const boardFileRel = join(docsDir, flags['board-file'] ?? 'BACKLOG.md');
  const backlogDirRel = flags['backlog-dir'] ?? 'backlog';

  const has = (rel) => existsSync(join(dir, rel));
  const initCmd = (s) => 'kaigong init' + (dirArg ? ' ' + dirArg : '') + ' --stage ' + s;

  const findings = [];
  const push = (title, where, expected, fix) => findings.push({ title, where, expected, fix });

  const agentsPath = join(dir, agentsRel);
  let agentsText = null;
  if (existsSync(agentsPath)) {
    agentsText = readFileSync(agentsPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  } else {
    push(
      'AGENTS.md not found (no stage source)',
      toPosix(agentsRel) + ' — not found in ' + dir,
      'an adopted AGENTS.md whose header carries a stage marker, e.g. "<!-- stage: S0 -->"',
      initCmd('S0') + '   # or restore the file from git'
    );
  }

  // Display name: the substituted "> Project: X" header of AGENTS.md beats the
  // directory name (walkthrough aside: "PASS ferment-tracker" for "Ferment").
  const name = projectNameFromAgents(agentsText) ?? dirName;

  // Strip inline code spans before marker detection: the shipped template
  // quotes "<!-- design: exempt -->" (and marker syntax) in prose inside
  // backticks — a quoted mention must never count as a real marker.
  const plainText = agentsText === null ? null : agentsText.replace(/`[^`\n]*`/g, '');
  let stage = null;
  if (plainText !== null) {
    const m = plainText.match(STAGE_RE);
    stage = m ? m[1] : null;
    if (stage === null) {
      push(
        'no stage marker in ' + toPosix(agentsRel),
        toPosix(agentsRel) + ' — no "<!-- stage: ... -->" comment found',
        'a line "<!-- stage: S0 -->" directly under the title (allowed: S0|S1|S2|S3|exempt|frozen|merged:PNN)',
        'edit ' + toPosix(agentsRel) + ': add "<!-- stage: S0 -->" under the title — stage lives only there'
      );
    } else if (!VALID_STAGE.test(stage)) {
      push(
        'invalid stage value "' + stage + '"',
        toPosix(agentsRel) + ' — marker parses as "' + stage + '"',
        'one of: S0 | S1 | S2 | S3 | exempt | frozen | merged:PNN',
        'edit ' + toPosix(agentsRel) + ': fix the stage marker value'
      );
      stage = 'INVALID';
    }
  }

  if (stage === 'exempt' || stage === 'frozen') {
    console.log('SKIP ' + name + ' (stage ' + stage + ')');
    return 0;
  }
  if (typeof stage === 'string' && stage.startsWith('merged:')) {
    console.log('SKIP ' + name + ' (stage ' + stage + ') — docs live with the target project');
    return 0;
  }

  if (stage === 'S0') {
    if (!has(adrIndexRel)) {
      push(
        'ADR index missing (advisory at S0 — create before the first dispatch)',
        toPosix(adrIndexRel) + ' — not found',
        'a decision-log index, e.g. a table "| ADR | Decision | Status |" with one row per ' + toPosix(join(docsDir, adrSub)) + '/NNNN-<slug>.md',
        initCmd('S0') + '   # manual: mkdir -p ' + toPosix(join(docsDir, adrSub)) + ' && edit ' + toPosix(adrIndexRel)
      );
    }
  } else if (stage === 'S1' || stage === 'S2' || stage === 'S3') {
    if (!has(plansRel)) {
      push(
        'Spec container missing (stage ' + stage + ')',
        toPosix(plansRel) + '/ — not found',
        'a ' + toPosix(plansRel) + '/ directory holding the gate-doc template and one gate doc per batch',
        initCmd(stage) + '   # manual: mkdir -p ' + toPosix(plansRel)
      );
    }
    if (!has(adrIndexRel)) {
      push(
        'ADR index missing (stage ' + stage + ')',
        toPosix(adrIndexRel) + ' — not found',
        'a decision-log index, e.g. a table "| ADR | Decision | Status |" with one row per ' + toPosix(join(docsDir, adrSub)) + '/NNNN-<slug>.md',
        initCmd(stage) + '   # manual: mkdir -p ' + toPosix(join(docsDir, adrSub)) + ' && edit ' + toPosix(adrIndexRel)
      );
    }
    if (!has(backlogDirRel) && !has(boardFileRel)) {
      push(
        'Task board missing (stage ' + stage + ')',
        toPosix(backlogDirRel) + '/ (dir) and ' + toPosix(boardFileRel) + ' (file) — neither found',
        'either a backlog/ directory (backlog.md CLI, pinned 1.55.3) or a plain ' + toPosix(boardFileRel) + ' table (| ID | Title | Type | Priority | Status | Acceptance |)',
        initCmd(stage) + '   # or, with the owner consent: npm i -D backlog.md@1.55.3'
      );
    }
    const archSectionOk = agentsText !== null && (agentsText.includes('架构现状') || agentsText.includes('Architecture (current)'));
    if (!has(archRel) && !has(archRel + '.md') && !archSectionOk) {
      push(
        'Architecture current state missing (stage ' + stage + ')',
        toPosix(archRel) + '/ , ' + toPosix(archRel) + '.md , and an "Architecture (current)" section in ' + toPosix(agentsRel) + ' — none found',
        toPosix(archRel) + '/current.md describing how the system is wired right now (updated at every converge step 7)',
        initCmd(stage) + '   # or add an "## Architecture (current)" section to ' + toPosix(agentsRel)
      );
    }
    if (stage === 'S2' || stage === 'S3') {
      const designExempt = plainText !== null && plainText.includes('<!-- design: exempt -->');
      let designDirHas = false;
      try {
        designDirHas = existsSync(join(dir, designDirRel)) && readdirSync(join(dir, designDirRel)).length > 0;
      } catch { designDirHas = false; }
      if (!designExempt && !has(designFileRel) && !designDirHas) {
        push(
          'Design spec missing (stage ' + stage + ')',
          toPosix(designFileRel) + ' (root) and ' + toPosix(designDirRel) + '/ (non-empty) — neither found; no "<!-- design: exempt -->" marker in ' + toPosix(agentsRel),
          'docs/design/DESIGN.md owning UI tokens / interface schemas — or, for a no-UI project, the marker "<!-- design: exempt -->" next to the stage marker',
          'create ' + toPosix(join(designDirRel, 'DESIGN.md')) + '   # or add "<!-- design: exempt -->" to ' + toPosix(agentsRel) + " (owner's call)"
        );
      }
    }
  }

  // ---- assertion: kickoff blind spot — code with no gate doc (AC-1, P16) ----
  // P16 adversarial rounds passed a check that only read docs: the checker
  // never looked at the code side of the repo. Heuristic repair: source files
  // present (by extension) while docs/plans/ holds no actual gate doc means
  // coding is running straight past the kickoff gate. Template and example
  // copies do not count as gate docs (same exclusion as the NC-OPEN scan).
  let gateEntries = [];
  try { gateEntries = readdirSync(join(dir, plansRel)); } catch { /* no plans dir: per-stage rules already cover it */ }
  const isActualGateDoc = (fname) =>
    fname.endsWith('.md') &&
    (fname.startsWith('gate-') || fname.startsWith('开工门槛-')) &&
    !fname.endsWith('.template.md') && !fname.endsWith('.example.md');
  const actualGateDocs = gateEntries.filter(isActualGateDoc);
  if (/^S[0-3]$/.test(stage ?? '')) {
    const firstSource = findSourceFile(dir, []);
    if (firstSource !== null && actualGateDocs.length === 0) {
      push(
        'Source code but no gate doc — kickoff blind spot (stage ' + stage + ')',
        firstSource + ' — source file found; ' + toPosix(plansRel) + '/ holds no actual gate doc (gate-*.md / 开工门槛-*.md; template and example copies excluded)',
        'one gate doc per coding batch in ' + toPosix(plansRel) + '/ before dispatch — the short spec that states what this batch does and does not do',
        initCmd(stage) + '   # installs ' + toPosix(join(plansRel, 'gate-doc.template.md')) + '; copy it to ' + toPosix(join(plansRel, 'gate-<batch>_v1.md')) + ', fill it in, then rerun: kaigong check' + (dirArg ? ' ' + dirArg : '')
      );
    }
  }

  // ---- assertion: stage S0 with a runnable entry point (AC-2, P16) ----
  // Dead-water S0: the repo already declares a runnable main flow while
  // AGENTS.md still says S0. Advisory only — the owner decides the stage
  // move; the check just refuses to stay silent about the signal. Stacks on
  // the S0 ADR index advisory above; replaces nothing.
  if (stage === 'S0') {
    const signal = mainflowSignal(dir, has);
    if (signal !== null) {
      push(
        'Stage S0 with a runnable entry point — consider S1 (advisory)',
        signal,
        'stage S1 once one command runs the main flow end to end — the marker in ' + toPosix(agentsRel) + ' is the single place stage lives',
        initCmd('S1') + '   # installs the S1 docs (task board, architecture current state); then set "<!-- stage: S1 -->" in ' + toPosix(agentsRel) + ', rerun: kaigong check' + (dirArg ? ' ' + dirArg : '')
      );
    }
  }

  // ---- assertion: template_version stale (A-09/F-01) ----
  // Compares the AGENTS.md header marker against the shipped template's.
  // Behind -> one finding with an update hint. Never edits anything. An
  // AGENTS.md without the marker (adopted, hand-written) is not flagged.
  if (agentsText !== null) {
    const mine = (agentsText.match(/<!--\s*template_version:\s*(\d+)\s*-->/) || [])[1];
    const shippedRel = toPosix(join(...(lang === 'zh' ? ['templates', 'zh'] : ['templates']), 'AGENTS.template.md'));
    let shipped = null;
    try {
      shipped = (templateText('AGENTS.template.md', lang).match(/<!--\s*template_version:\s*(\d+)\s*-->/) || [])[1];
    } catch { shipped = null; } // unreadable shipped template: skip, other rules still run
    if (mine !== undefined && shipped !== null && Number(mine) < Number(shipped)) {
      push(
        'template_version stale — your ' + toPosix(agentsRel) + ' is behind the shipped template (' + mine + ' < ' + shipped + ')',
        toPosix(agentsRel) + ' — header "<!-- template_version: ' + mine + ' -->" vs shipped ' + shippedRel + ' "<!-- template_version: ' + shipped + ' -->"',
        'the shipped template version marker "<!-- template_version: ' + shipped + ' -->" in your AGENTS.md (upgrades warn only — kaigong never edits your file)',
        'diff "' + toPosix(join(PKG_ROOT, ...(lang === 'zh' ? ['templates', 'zh'] : ['templates']), 'AGENTS.template.md')) + '" "' + toPosix(agentsRel) + '", merge by hand, bump the marker to ' + shipped + ', then rerun: kaigong check' + (dirArg ? ' ' + dirArg : '')
      );
    }
  }

  // ---- assertion: NC-OPEN decision cards (A-02, kickoff gate) ----
  // A card is open only when a decision-ledger table row's State cell reads
  // exactly "NC-OPEN". Teaching prose inside a copied template (the kickoff
  // rule sentence, the grep hint) is not a table row and never counts; a row
  // naming NC-OPEN together with NC-RESOLVED is a state-enum definition, not
  // an open card; a row still holding <...>/{{...}} placeholders is an
  // unfilled template example. One finding per file, first line + card count.
  for (const fname of actualGateDocs.slice().sort()) {
    // Chinese-named gate docs (开工门槛-*.md, the zh template set) scan under
    // the same rules as gate-*.md. actualGateDocs — hoisted for the AC-1
    // blind-spot assertion above — applies that same filter (and the
    // .template.md / .example.md exclusions) exactly once.
    let text;
    try { text = readFileSync(join(dir, plansRel, fname), 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
    const hitLines = openCardLines(text);
    if (hitLines.length === 0) continue;
    const rel = toPosix(join(plansRel, fname));
    push(
      hitLines.length + ' NC-OPEN decision card' + (hitLines.length === 1 ? '' : 's') + ' in ' + rel + ' — resolve before dispatch (kickoff)',
      rel + ':' + hitLines[0] + ' — open decision-ledger row(s) "NC-OPEN" on line(s) ' + hitLines.join(', '),
      'every card NC-RESOLVED or NC-N/A before coding dispatch, e.g. "| NC-1 | currency? | a | NC-RESOLVED: 1a — single currency; multi parked on the board |"',
      'send the open cards to the owner as one numbered batch (solo mode: accept the recommended defaults), mark each NC-RESOLVED, then rerun: kaigong check' + (dirArg ? ' ' + dirArg : '')
    );
  }

  // ---- report: every finding = where + expected + fix ----
  if (findings.length > 0) {
    console.log('kaigong check — ' + dir + (stage ? ' (stage ' + stage + ')' : ''));
    findings.forEach((f, i) => {
      console.log('');
      console.log('[' + (i + 1) + '/' + findings.length + '] ' + f.title);
      console.log('  where    : ' + f.where);
      console.log('  expected : ' + f.expected);
      console.log('  fix      : ' + f.fix);
    });
    console.log('');
  }
  const stageLabel = stage ?? '-';
  if (findings.length === 0) {
    console.log('PASS ' + name + ' (stage ' + stageLabel + ')');
    return 0;
  }
  if (flags.strict) {
    console.log('FAIL ' + name + ' (stage ' + stageLabel + ') — ' + findings.length + ' finding(s) under --strict');
    return 1;
  }
  console.log('WARN ' + name + ' (stage ' + stageLabel + ') — ' + findings.length + ' finding(s) (advisory; rerun with --strict to fail)');
  return 0;
}
