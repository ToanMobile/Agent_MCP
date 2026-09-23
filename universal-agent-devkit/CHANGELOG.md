# Changelog

All notable changes to Universal Agent DevKit. Versions follow `.claude-plugin/plugin.json`.

## 1.1.0 — 2026-09-23

A PO + QA review of the whole DevKit found 58 verified defects (1 critical, 13 high) and a gap
between what the docs claimed and what the code did. This release fixes them.

### Security / gates
- **post-fix gate:** test commands are read from the regression matrix at `HEAD`; a matrix or an
  existing test edited in the same change is UNVERIFIED, never PASS (previously an agent could turn
  `exit 1` into `true` and pass). Secret scan whitelists only exact example suffixes, detects AWS/GitHub/
  Slack/Google keys, JWTs, private keys, base64 and unquoted values; test files are recognised by
  directory/suffix, not by the substring "test". `--diff` values starting with `-` are refused. Lessons
  are recorded only after a PASS. DevKit-installed links no longer count as user changes. Output labels
  each section BLOCKING or REMINDER.
- **hooks:** `block-dangerous-git` catches subshells, `if`/`{}` blocks, `timeout`/`nice`/`sudo -u`/`watch`/
  `find -exec`/`xargs` wrappers, `$var` commands, git aliases and `os.system`/`subprocess`; `git restore
  --staged` is allowed. `hardware_safety_gate` handles flags before subcommands, `rm -fr /system`,
  `dd of=/dev/…`, and fails closed on bad JSON. `security_gate` only accepts a real review (not `echo
  security-check`) and sees Bash writes to sensitive files. `precode_gate`/`security_gate` fail closed
  without python3; the rest warn. Stop gates block one re-stop, then release with a logged warning.
  Hooks create `.claude/audit-gate/.gitignore`. `contract_facts_test.sh` rewritten for this repo.

### Installer / CLI
- `agent-kit init [path] [opts]` works with a path and with flags, and without a TTY.
- Unknown options, profiles, modes and languages exit 2 before writing anything.
- A project's own `commands/`, `rules/`, `skills/` directories are left in place (skipped with a warning)
  instead of being renamed to `*_old`.
- The installer no longer writes into the DevKit checkout; copy mode is honoured by every adapter;
  per-file hash ledger (`.devkit-files`) so upgrades only back up files the user edited; backups of
  commands/hooks go to a sibling `<dir>_old/` (no more `/fix_old` commands); same-second backups never
  clobber each other; `.gitignore` entries are added to git projects; symlink mode warns in git repos.
- `make install` / `agent-kit install-global` also install `postfix-gate`.
- New `agent-kit restore-old [path] [--apply]` puts recorded `*_old` backups back (dry-run by default,
  never overwrites content that is not the DevKit's).

### Profiles / health / scripts
- `agent-kit profile` writes to the git root of the current directory (refuses the DevKit itself), backs
  up instead of deleting, accepts positional/case-insensitive names and aliases, writes the matrix to
  `.agents/regression_matrix.active.json`.
- `agent-kit health` no longer prints hard-coded test results; tests are "not run" unless `--run-tests`.
- Councils: one list of 10, duplicates removed; profiles reference only existing councils and MCPs
  (Unity/Blender MCPs are listed as external for the game profile).
- `voice-assistant` profile gained `DESIGN.md` and `instincts.md`.
- Linters are documented as regex-based, support multi-line signatures and exit 2 on a missing path.
- The `scripts/audit_*` "agent" scripts are relabelled as grep-based self-consistency checks.

### Catalog / docs
- 10 documented aliases now exist (`/adr /android-qa /deprecate /enrich /grill /logging /module-design
  /postfix-gate /skill-author /step`).
- `skills/giao` frontmatter is valid YAML; references to another repo's `.Codex/` and `rulebook/` removed;
  `qc` detects the build tool for non-Gradle projects; `qc`/`deploy` state their Android scope.
- README EN/VI: Quick Start moved to the top; counts and claims corrected ("8-layer" gate, "AST linter",
  "50 agents", fixed test totals removed); new sections: which QA command when, Team/CI, uninstall/
  restore, troubleshooting.
- MCP npm packages pinned to exact versions.
- Added `LICENSE` (MIT) and this changelog; plugin version 1.1.0.
- New `tests/test_repo_consistency.sh` keeps links, JSON, frontmatter, documented commands and
  documented counts honest; `agent-kit test` also runs `contract_facts_test.sh`.

### Action needed by maintainers
- Local state files are still tracked from earlier commits. `.gitignore` now lists them; untrack them
  once with:
  `git rm --cached .active-profile.json .antigravity-pm.json .claude/settings_old.json templates/regression_matrix.active.json templates/last_postfix_audit_report.md`
- Symlinks committed before this release were absolute; the working tree now uses relative links —
  commit them.

## 1.0.0

Initial release.
