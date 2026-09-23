#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# regression_gate.sh — Stop hook: the living regression checklist must be green
# for everything the current change touches before the agent may finish.
#
# Runs `post-fix-gate.py --run-tests --task <session>` when there are uncommitted
# changes. The gate re-runs every regression test whose watch_files match the
# change, records real PASS/FAIL into .agents/regression_checklist.md, and refuses
# PASS for changed source files no test watches (UNCOVERED).
#
# BLOCK (exit 2, reason → Claude) when the gate says REJECT (exit 1) or
# UNVERIFIED (exit 2): a related test fails, a changed file has no test, …
#
# Enforced ONLY for a project that has adopted the matrix: a regression matrix
# committed in the repo whose content differs from every DevKit sample
# (templates/ + profiles/*). Sample matrices name placeholder tests that do not
# exist in a real project — enforcing them would trap every session. Without an
# adopted matrix the hook is silent.
#
# Cheap when nothing changed: the result is cached per working-tree fingerprint,
# so a second Stop on the same diff does not re-run the tests.
# Loop-guard: MAX_ATTEMPTS blocks per fingerprint, then the stop is allowed with a
# visible warning (systemMessage) — a broken test can never trap the session.
# Escape hatch: REGRESSION_GATE=0 (logged). Fail-open on internal error.
#
# Stop hook protocol: stdin JSON; exit 2 blocks (stderr→Claude); exit 0 allows.
# bash 3.2 compatible.
# ─────────────────────────────────────────────────────────────────────────────
set -u

INPUT="$(cat)"
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="${REPO_ROOT}/.claude/audit-gate"
mkdir -p "${LOG_DIR}" 2>/dev/null || exit 0
[ -f "${LOG_DIR}/.gitignore" ] || printf '*\n' > "${LOG_DIR}/.gitignore" 2>/dev/null || true
LOG="${LOG_DIR}/regression_gate.log"

if [ "${REGRESSION_GATE:-1}" = "0" ]; then
  echo "$(date +%Y-%m-%dT%H:%M:%S) skipped: REGRESSION_GATE=0" >> "${LOG}"
  exit 0
fi
command -v python3 >/dev/null 2>&1 || exit 0
git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Locate the DevKit: this script's real path (symlink install), else `postfix-gate` on PATH.
SELF="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$0" 2>/dev/null)"
GATE="$(dirname "$(dirname "${SELF}")")/bin/post-fix-gate.py"
if [ ! -f "${GATE}" ]; then
  PG="$(command -v postfix-gate 2>/dev/null || true)"
  [ -n "${PG}" ] && GATE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${PG}")"
fi
[ -f "${GATE}" ] || { echo "$(date +%Y-%m-%dT%H:%M:%S) skipped: post-fix-gate.py not found" >> "${LOG}"; exit 0; }

printf '%s' "${INPUT}" | REPO_ROOT="${REPO_ROOT}" GATE="${GATE}" LOG="${LOG}" \
  MAX_ATTEMPTS="${REGRESSION_GATE_MAX_ATTEMPTS:-2}" python3 -c '
import hashlib, json, os, re, subprocess, sys, time

repo, gate, log = os.environ["REPO_ROOT"], os.environ["GATE"], os.environ["LOG"]
max_attempts = int(os.environ.get("MAX_ATTEMPTS", "2"))
devkit = os.path.dirname(os.path.dirname(gate))

def note(msg):
    with open(log, "a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S") + " " + msg + "\n")

try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(data.get("session_id") or "nosession"))[:40]

def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True).stdout

status = git("status", "--porcelain=v1", "-z", "-uall")
# Only our own bookkeeping changed (audit-gate state, the checklist itself) => nothing to gate.
own = (".claude/audit-gate/", ".agents/regression_status.json", ".agents/regression_checklist.md")
entries = [e for e in status.decode("utf-8", "replace").split("\0") if len(e) > 3 and not e[3:].startswith(own)]
if not entries:
    sys.exit(0)

# Adopted matrix? (committed in the repo, not a byte-for-byte DevKit sample)
def norm(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.dumps(json.load(f), sort_keys=True)
    except Exception:
        return None
samples = set()
for root, _, files in os.walk(os.path.join(devkit, "profiles")):
    if "regression_matrix.json" in files:
        samples.add(norm(os.path.join(root, "regression_matrix.json")))
samples.add(norm(os.path.join(devkit, "templates", "regression_matrix.json")))
candidates = [os.path.join(repo, "templates", "regression_matrix.active.json"),
              os.path.join(repo, ".agents", "active-profile", "regression_matrix.json"),
              os.path.join(repo, "templates", "regression_matrix.json")]
matrix = next((c for c in candidates if os.path.exists(c)), None)
if not matrix:
    sys.exit(0)
real = os.path.realpath(matrix)
toplevel = os.path.realpath(git("rev-parse", "--show-toplevel").decode().strip() or repo)
if not real.startswith(toplevel + os.sep) or norm(real) in samples:
    note(f"skipped: matrix {matrix} is a DevKit sample / outside the repo (not adopted)")
    sys.exit(0)

# Fingerprint of the USER change only — the gate rewrites the checklist on every run,
# which must not make the same change look new (that would defeat the loop guard).
excl = [":(exclude).claude/audit-gate", ":(exclude).agents/regression_status.json",
        ":(exclude).agents/regression_checklist.md"]
fp = hashlib.sha256("\0".join(entries).encode() + git("diff", "HEAD", "--binary", "--", ".", *excl)).hexdigest()[:20]
state_file = os.path.join(os.path.dirname(log), "regression_gate.state.json")
try:
    state = json.load(open(state_file, encoding="utf-8"))
except Exception:
    state = {}
if state.get("pass_fp") == fp:
    sys.exit(0)

res = subprocess.run([sys.executable, gate, "--run-tests", "--json", "--task", "session-" + sid[:12],
                      "--timeout", os.environ.get("REGRESSION_GATE_TEST_TIMEOUT", "600")],
                     cwd=repo, capture_output=True, text=True, errors="replace",
                     env={**os.environ, "CLAUDE_PROJECT_DIR": repo})
if res.returncode in (0, 3):
    state["pass_fp"] = fp
    state.pop("attempts", None)
    json.dump(state, open(state_file, "w", encoding="utf-8"))
    note(f"pass fp={fp} exit={res.returncode}")
    sys.exit(0)
if res.returncode not in (1, 2):
    note("fail-open: gate crashed exit=%s: %r" % (res.returncode, res.stderr[-400:]))
    sys.exit(0)

summary = {}
for line in reversed(res.stdout.splitlines()):
    if line.startswith("{"):
        try:
            summary = json.loads(line)
            break
        except ValueError:
            pass
strip = lambda s: re.sub(r"\x1b\[[0-9;]*m", "", s or "")
verdict = strip(summary.get("verdict")) or ("exit " + str(res.returncode))
lines = ["Regression gate CHƯA ĐẠT — " + verdict]
for t in summary.get("regression_tests", []):
    if t.get("status") != "PASS":
        lines.append("  - %s %s: %s (lệnh: %s)" % (t.get("id"), t.get("name"), t.get("status"), t.get("command")))
for f in summary.get("uncovered", [])[:10]:
    lines.append("  - UNCOVERED:%s — file code đổi nhưng chưa test hồi quy nào theo dõi" % f)
lines.append("Checklist: %s · báo cáo: %s" % (summary.get("checklist", ".agents/regression_checklist.md"), summary.get("report", "-")))

attempts = state.setdefault("attempts", {})
attempts[fp] = attempts.get(fp, 0) + 1
json.dump(state, open(state_file, "w", encoding="utf-8"))
note(f"block fp={fp} attempt={attempts[fp]} exit={res.returncode}")
if attempts[fp] > max_attempts:
    msg = "\n".join(lines + ["(Đã chặn %d lần cho cùng thay đổi — cho dừng để không kẹt phiên. Người dùng cần xem lại.)" % max_attempts])
    print(json.dumps({"systemMessage": msg}, ensure_ascii=False))
    sys.exit(0)
lines.append("Sửa code/test cho các mục trên rồi dừng lại. Không sửa test cũ để lách; file chưa có test: thêm test vào regression_matrix.json "
             "hoặc `python3 bin/regression_checklist.py link UNCOVERED:<file> <TEST-ID>`. "
             "Nếu thực sự không làm được, dừng và nói rõ cho người dùng.")
print("\n".join(lines), file=sys.stderr)
sys.exit(2)
' || exit $?
