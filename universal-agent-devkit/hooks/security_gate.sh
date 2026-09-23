#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# security_gate.sh — Stop hook: CLAUDE.md `check 4c` (security review by trigger).
#
# `check 4c` says a diff touching an attack surface MUST get `/scan` or the
# security-checklist on that scope, and may NOT be waved through as NOT
# APPLICABLE. It was the only MANDATORY check in the Deep Audit Loop with no
# machine behind it — and the repo's own incident memory is mostly this class:
# an API key committed in a fixture, per-keystroke search text shipped to
# analytics, a permission-shaped file-open bug, WebView file access.
#
# BLOCK (exit 2) when BOTH hold:
#   • this session edited a file that touches an attack surface (path or the
#     text just written), AND
#   • no security review ran AFTER that edit — /scan, the security-checklist
#     skill, or a security sub-agent.
#
# WHAT COUNTS AS ATTACK SURFACE — deliberately NARROW (precision > recall, the
# same policy as claim_check/comment_claim_guard). A gate that cries on ordinary
# UI work gets switched off, and CLAUDE.md is explicit that a false positive is
# worse than a miss. Broad-but-common surfaces (`getIntent()`, `openInputStream`)
# are NOT triggers: in a document reader they appear in nearly every diff.
#
# NOT attack surface, by design:
#   • anything under `.claude/` — rules, hooks, this gate, the harness. They are
#     stuffed with the trigger words BECAUSE they describe them.
#   • `*.md`, `plans/` — prose.
#   • `/src/test/` — JVM unit tests have no runtime surface.
#
# WHAT IT CANNOT DO: judge whether the review was any good, or whether it covered
# the right scope. It only knows that something ran after the edit.
#
# Loop guard: MAX_ATTEMPTS reminders per session, then it releases with a logged
# warning — the duty falls back on you, exactly as with review_gate.
# Sources of "edited": Edit/Write/NotebookEdit calls, Bash commands that write
# (sed -i, >, tee, cp, mv, …) to an attack-surface path or text, and — as a
# second source — `git diff`/untracked files on an attack-surface path changed
# since the session began (QA K-5, 2026-09-23).
# Review = Skill/Agent/SlashCommand review call only. A Bash command that merely
# contains the words "security-check" is NOT a review.
#
# Escape hatch: SECURITY_GATE=0 (logged). Fail-open on any internal error,
# EXCEPT missing python3, which fails closed (see below).
# Stop hook protocol: stdin JSON; exit 2 blocks (stderr→Claude); exit 0 allows.
# bash 3.2 compatible.
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="${REPO_ROOT}/.claude/audit-gate"
mkdir -p "${LOG_DIR}"
[ -f "${LOG_DIR}/.gitignore" ] || printf '*\n' > "${LOG_DIR}/.gitignore" 2>/dev/null || true

INPUT="$(cat)"

if [ "${SECURITY_GATE:-1}" = "0" ]; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S)] SECURITY_GATE=0 — gate bypassed" >> "${LOG_DIR}/security_gate.log" 2>/dev/null
  exit 0
fi

# QA K-4: without python3 this gate cannot judge anything. Fail CLOSED (it guards
# an attack surface / blind edits) — except on the Stop loop-guard pass, so a box
# without python3 is never wedged. Disable with SECURITY_GATE=0.
if ! command -v python3 >/dev/null 2>&1; then
  case "${INPUT}" in
    *'"stop_hook_active":true'*|*'"stop_hook_active": true'*)
      echo "⚠ security_gate: python3 không có — gate KHÔNG chạy (lần Stop thứ 2, thả để tránh treo)." >&2; exit 0 ;;
  esac
  echo "🛑 security_gate: cần python3 để kiểm tra — chặn để an toàn. Cài python3 hoặc đặt SECURITY_GATE=0 để tắt gate." >&2
  exit 2
fi
SG_INPUT="${INPUT}" SG_LOG="${LOG_DIR}/security_gate.log" SG_DIR="${LOG_DIR}" SG_REPO="${REPO_ROOT}" \
SG_TS="$(date +%Y-%m-%dT%H:%M:%S)" SG_MAX="${SECURITY_GATE_MAX_ATTEMPTS:-3}" \
python3 <<'PY'
import os, sys, json, re

raw   = os.environ.get("SG_INPUT", "")
log   = os.environ.get("SG_LOG", "/dev/null")
sdir  = os.environ.get("SG_DIR", "/tmp")
ts    = os.environ.get("SG_TS", "?")
try:
    maxatt = int(os.environ.get("SG_MAX", "3") or "3")
except ValueError:          # QA K-6: a non-numeric env var must not crash the gate open
    maxatt = 3

def logline(s):
    try:
        with open(log, "a") as fh:
            fh.write(s + "\n")
    except Exception:
        pass

try:
    d = json.loads(raw)
except Exception as e:
    logline(f"[{ts}] stdin parse fail: {e!r} — fail-open")
    sys.exit(0)

# Loop guard (QA K-12, 2026-09-23). This is a REMINDER gate, not fail-closed:
# Claude Code sets stop_hook_active on the Stop that follows a block, and a gate
# that blocks forever wedges the session. Previously the very first re-Stop was
# released silently. Now the chain is counted per session: the gate may block
# SECURITY_GATE_MAX_RESTOPS (default 1) more time(s) on re-Stop, then releases — loudly, to
# stderr and the log — and the unverified claim becomes the model's duty.
_sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(d.get("session_id") or "default"))[:64] or "default"
_chain = os.path.join(os.path.dirname(log) or ".", f"security_gate_stopchain_{_sid}")
try:
    _extra = int(os.environ.get("SECURITY_GATE_MAX_RESTOPS", "1") or "1")
except ValueError:
    _extra = 1
_chain_n = 0
if d.get("stop_hook_active"):
    try:
        _chain_n = int(open(_chain).read().strip() or "0") + 1
    except Exception:
        _chain_n = 1
    try:
        open(_chain, "w").write(str(_chain_n))
    except Exception:
        pass
else:
    try:
        os.remove(_chain)
    except Exception:
        pass
_real_exit = sys.exit
def _guarded_exit(code=0):
    if code == 2 and _chain_n > _extra:
        logline(f"[{ts}] RELEASED on re-Stop #{_chain_n} — claim still unverified")
        sys.stderr.write("⚠ security_gate: đã nhắc lại {} lần — THẢ Stop để tránh kẹt vòng lặp. "
                         "Claim ở trên vẫn CHƯA được kiểm chứng.\n".format(_chain_n))
        _real_exit(0)
    _real_exit(code)
sys.exit = _guarded_exit

# ── what is out of scope ────────────────────────────────────────────────────
EXCLUDE_SUBSTR = ("/.claude/", "/plans/", "/src/test/", "/build/", "/.git/")
EXCLUDE_SUFFIX = (".md", ".txt")

def excluded(path):
    p = path.replace(os.sep, "/")
    if p.endswith(EXCLUDE_SUFFIX):
        return True
    if any(s in p for s in EXCLUDE_SUBSTR):
        return True
    return p.startswith(".claude/") or "/.claude" in p

# ── triggers: path shape, then text just written ────────────────────────────
PATH_TRIGGERS = [
    (re.compile(r"AndroidManifest\.xml$", re.I),            "AndroidManifest"),
    (re.compile(r"network_security_config[^/]*\.xml$", re.I), "network security config"),
    (re.compile(r"\.keystore$|\.jks$", re.I),               "keystore"),
    (re.compile(r"google-services\.json$", re.I),           "Firebase config"),
    (re.compile(r"/(security|auth)/", re.I),                "security/auth package"),
]
TEXT_TRIGGERS = [
    (re.compile(r"<uses-permission|android:permission=", re.I),        "permission"),
    (re.compile(r"android:exported\s*=|<intent-filter", re.I),          "exported component / intent-filter"),
    (re.compile(r"javaScriptEnabled|addJavascriptInterface|"
                r"setAllowFileAccess|allowFileAccess|loadDataWithBaseURL", re.I), "WebView surface"),
    (re.compile(r"usesCleartextTraffic|CLEARTEXT|trustAllCerts|"
                r"HostnameVerifier", re.I),                             "cleartext / TLS trust"),
    (re.compile(r"storePassword|keyPassword|keyAlias|signingConfig", re.I), "signing / keystore"),
    (re.compile(r"apiKey|api_key|Bearer\s|accessToken|client_secret", re.I), "credential / token"),
    (re.compile(r"logEvent\(|setUserProperty\(|recordException\(", re.I),  "telemetry payload"),
]

def triggers_for(path, text):
    hits = []
    for rx, label in PATH_TRIGGERS:
        if rx.search(path):
            hits.append(label)
    if text:
        for rx, label in TEXT_TRIGGERS:
            if rx.search(text):
                hits.append(label)
    return hits

REVIEW_SKILLS = {"security-checklist", "scan", "/scan", "security-review"}
REVIEW_AGENTS_RX = re.compile(r"security", re.I)
# Only a real review invocation counts (QA K-5, 2026-09-23): a Skill/Agent call,
# or a slash command whose NAME is a review. A Bash command merely containing the
# words "security-check" (e.g. `echo security-check done`) proves nothing.
REVIEW_SLASH_RX = re.compile(r"^\s*/(scan|security-review|security-checklist)\b", re.I)

# Shell writes to files (QA K-5: `sed -i` on the Manifest bypassed an Edit-only scan).
SHELL_WRITE_RX = re.compile(r"\bsed\s+(-[A-Za-z]*i|--in-place)|\bperl\s+-[A-Za-z]*i|>>?|\btee\b|"
                            r"\b(cp|mv|install|patch|dd)\b|\bgit\s+(apply|am|checkout|restore)\b", re.I)

def shell_hits(cmd):
    """Attack-surface files/text a shell command may have written."""
    if not SHELL_WRITE_RX.search(cmd):
        return []
    hits = []
    for tok in re.findall(r"[^\s'\"<>|;&]+", cmd):
        if not excluded(tok):
            for rx, label in PATH_TRIGGERS:
                if rx.search(tok):
                    hits.append(label)
    for rx, label in TEXT_TRIGGERS:
        if rx.search(cmd):
            hits.append(label)
    return sorted(set(hits))

# ── one transcript pass ─────────────────────────────────────────────────────
tp = d.get("transcript_path")
idx = 0
last_review_idx = -1
last_bash_idx = -1
first_ts = None
flagged = {}          # path -> (idx, [labels])
if tp and os.path.exists(tp):
    try:
        with open(tp) as fh:
            for rawline in fh:
                rawline = rawline.strip()
                if not rawline:
                    continue
                try:
                    rec = json.loads(rawline)
                except Exception:
                    continue
                if first_ts is None and isinstance(rec.get("timestamp"), str):
                    first_ts = rec["timestamp"]
                content = (rec.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for blk in content:
                    if not isinstance(blk, dict) or blk.get("type") != "tool_use":
                        continue
                    idx += 1
                    name = blk.get("name", "")
                    inp = blk.get("input") or {}
                    if not isinstance(inp, dict):
                        continue
                    if name in ("Edit", "Write", "NotebookEdit"):
                        fp = inp.get("file_path") or inp.get("notebook_path") or ""
                        if not isinstance(fp, str) or not fp or excluded(fp):
                            continue
                        text = inp.get("new_string") or inp.get("content") or ""
                        if not isinstance(text, str):
                            text = ""
                        hits = triggers_for(fp, text)
                        if hits:
                            flagged[fp] = (idx, sorted(set(hits)))
                    elif name == "Skill":
                        sk = str(inp.get("skill", "") or inp.get("command", "")).lstrip("/")
                        if sk in REVIEW_SKILLS:
                            last_review_idx = idx
                    elif name in ("Agent", "Task"):
                        if REVIEW_AGENTS_RX.search(str(inp.get("subagent_type", ""))):
                            last_review_idx = idx
                    elif name == "SlashCommand":
                        if REVIEW_SLASH_RX.search(str(inp.get("command", ""))):
                            last_review_idx = idx
                    elif name == "Bash":
                        last_bash_idx = idx
                        cmd = str(inp.get("command", ""))
                        hits = shell_hits(cmd)
                        if hits:
                            flagged[f"(Bash) {cmd[:80]}"] = (idx, hits)
    except Exception as e:
        logline(f"[{ts}] transcript scan fail: {e!r} — fail-open")
        sys.exit(0)

# ── second source: git diff (QA K-5) ────────────────────────────────────────
# Files on an attack-surface PATH that are modified/untracked in the working tree,
# changed after this session began, and not already seen via Edit/Write. They
# could only have been written by a shell command, so they are dated at the last
# Bash call: a review after that call covers them.
repo = os.environ.get("SG_REPO", "")
session_start = None
if first_ts:
    try:
        from datetime import datetime
        session_start = datetime.fromisoformat(first_ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        session_start = None
if session_start is None and tp and os.path.exists(tp):
    st = os.stat(tp)
    session_start = getattr(st, "st_birthtime", None)
if repo and session_start is not None and last_bash_idx >= 0:
    try:
        import subprocess
        def git(*a):
            r = subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, timeout=5)
            return r.stdout.splitlines() if r.returncode == 0 else []
        changed = set(git("diff", "--name-only", "HEAD")) | set(git("ls-files", "--others", "--exclude-standard"))
        seen = {os.path.realpath(p) for p in flagged if not p.startswith("(Bash)")}
        for rel in sorted(changed):
            full = os.path.join(repo, rel)
            if excluded("/" + rel) or os.path.realpath(full) in seen or not os.path.exists(full):
                continue
            if os.path.getmtime(full) < session_start:
                continue
            hits = [label for rx, label in PATH_TRIGGERS if rx.search("/" + rel)]
            if hits:
                flagged[rel + " (git diff, không qua Edit)"] = (last_bash_idx, hits)
    except Exception as e:
        logline(f"[{ts}] git diff source fail: {e!r} — skipped")

# Only edits that came AFTER the last review still need one — same
# "reviewed, then kept coding" hole review_gate closes.
unreviewed = {p: v for p, v in flagged.items() if v[0] > last_review_idx}

sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(d.get("session_id", "default")))[:64] or "default"
att_path = os.path.join(sdir, f"security_gate_attempts_{sid}")

if not unreviewed:
    try:
        if os.path.exists(att_path):
            os.remove(att_path)
    except Exception:
        pass
    logline(f"[{ts}] flagged={len(flagged)} unreviewed=0 — pass")
    sys.exit(0)

try:
    attempts = int(open(att_path).read().strip() or "0") if os.path.exists(att_path) else 0
except Exception:
    attempts = 0
attempts += 1
try:
    open(att_path, "w").write(str(attempts))
except Exception:
    pass

if attempts > maxatt:
    logline(f"[{ts}] RELEASE after {attempts} reminders — duty falls back to the model")
    sys.exit(0)

out = ["⛔ SECURITY (CLAUDE.md check 4c): diff chạm attack surface nhưng chưa có security review.", ""]
for p, (_, labels) in sorted(unreviewed.items())[:8]:
    out.append(f"  • {p}")
    out.append(f"      trigger: {', '.join(labels)}")
out += ["",
        "  check 4c là MANDATORY, không được ghi NOT APPLICABLE cho đúng các trigger này.",
        "  Chạy `/scan` hoặc skill `security-checklist` trên ĐÚNG scope trên, rồi kết luận.",
        "  Không chạy được (thiếu quyền/tool/device) → ghi BLOCKED + residual, đừng lờ đi.",
        f"  (nhắc {attempts}/{maxatt}; sau đó gate tự thả và nghĩa vụ rơi về bạn — W4 cấm lờ.)"]
logline(f"[{ts}] BLOCK — unreviewed={sorted(unreviewed)} attempt={attempts}")
sys.stderr.write("\n".join(out) + "\n")
sys.exit(2)
PY
rc=$?
[ "${rc}" -eq 2 ] && exit 2
exit 0
