#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bash_write_ledger.sh — PreToolUse/PostToolUse Hook: Concurrency-Safe Shell Ledger
#
# Records command line execution windows, session IDs, and timestamps into
# `.claude/audit-gate/bash_ledger.jsonl`. Enables post-fix verification gates to
# deterministically correlate source edits with exact tool invocation windows.
#
# Protocol: stdin JSON; exit 0 always (fail-open observability hook).
#
# STATUS: OPT-IN HELPER — deliberately NOT wired in hooks/hooks.json or
# templates/claude_settings.json. Nothing in the DevKit reads bash_ledger.jsonl
# yet; wire it yourself (PreToolUse matcher "Bash") if you want the audit trail.
#
# SECRETS (QA K-14): the command line is masked before it is written — values of
# password/token/secret/api-key style assignments and flags, Bearer tokens, URL
# credentials, and well-known key shapes (AKIA…, ghp_…, xox?-…, sk-…, AIza…, JWT)
# become ***. Masking is best-effort; the ledger stays gitignored.
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="${REPO_ROOT}/.claude/audit-gate"
mkdir -p "${LOG_DIR}"
[ -f "${LOG_DIR}/.gitignore" ] || printf '*\n' > "${LOG_DIR}/.gitignore" 2>/dev/null || true
LEDGER="${LOG_DIR}/bash_ledger.jsonl"

LEDGER_PATH="${LEDGER}" python3 -c '
import sys, json, os, time, re

MASKS = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1***"),
    (re.compile(r"(?i)((?:password|passwd|pwd|pass|token|secret|api[_-]?key|access[_-]?key|auth|credential)s?[A-Za-z_]*\s*[=:]\s*)(\"[^\"]*\"|\x27[^\x27]*\x27|\S+)"), r"\1***"),
    (re.compile(r"(?i)(--?(?:password|passwd|pass|token|secret|api-?key|auth)[= ]\s*)(\S+)"), r"\1***"),
    (re.compile(r"(://[^/\s:@]+:)[^@\s]+@"), r"\1***@"),
    (re.compile(r"((?:^|\s)(?:-u|--user)[= ]\s*[^\s:]+:)\S+"), r"\1***"),
    (re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "***"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "***"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "***"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "***"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), "***"),
]

def mask(text):
    for rx, repl in MASKS:
        text = rx.sub(repl, text)
    return text

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

ledger_path = os.environ.get("LEDGER_PATH", "")
if not ledger_path:
    sys.exit(0)

try:
    data = json.loads(raw)
    sid = data.get("session_id") or data.get("sessionId") or "unknown_sid"
    tool = data.get("tool_name") or data.get("name") or "Bash"
    inp = data.get("tool_input") or data.get("input") or {}
    cmd = inp.get("command") or inp.get("CommandLine") or ""
    
    entry = {
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sid": str(sid),
        "tool": str(tool),
        "cmd": mask(str(cmd))[:500]
    }
    
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
except Exception:
    pass
'

exit 0
