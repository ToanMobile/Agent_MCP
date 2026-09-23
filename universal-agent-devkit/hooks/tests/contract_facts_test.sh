#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# contract_facts_test.sh — every MEASURABLE fact the hook layer claims about
# itself must be regenerable from the files on disk.
#
# Rewritten 2026-09-23 (QA M-11): the previous version was carried over from a
# different repo and asserted facts about files that do not exist here
# (.claude/rulebook/, .claude/knowledge/machine_gate_layer.md, "CHẶN THẬT"
# blocks in CLAUDE.md), so it could only ever fail. It now checks THIS DevKit:
#
#   F1. The three hook registries agree: hooks/hooks.json (plugin),
#       templates/claude_settings.json (installer template) and
#       .claude/settings.json (the DevKit's own dogfood config) wire the same
#       hooks on the same events.
#   F2. Every hooks/*.sh is either wired in hooks/hooks.json or says
#       "OPT-IN HELPER" in its header — no silent orphans.
#   F3. Every wired hook file exists, parses (`bash -n`), is executable, and
#       has at least one contract point in hook_contract_test.sh.
#   F4. Every registry command invokes the hook through `bash …` (works even
#       when the executable bit is lost, e.g. after a zip download).
#   F5. The hook contract harness itself is green.
#
# A red case means a registry, a header or a hook disagree: fix one of them —
# do not relax the case.
# Usage: bash hooks/tests/contract_facts_test.sh    (bash 3.2 compatible)
# ─────────────────────────────────────────────────────────────────────────────
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
cd "${ROOT}" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "contract_facts_test.sh: python3 is required" >&2
  exit 1
fi

echo "contract_facts_test.sh — hook layer facts (${ROOT})"
echo

python3 - <<'PY'
import glob, json, os, re, subprocess, sys

PASS = FAIL = 0
def check(ok, name, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name:<60} {detail}")
    else:
        FAIL += 1
        print(f"  DEVIATING  {name:<54} {detail}")

REGISTRIES = {
    "hooks/hooks.json": "plugin",
    "templates/claude_settings.json": "installer template",
    ".claude/settings.json": "dogfood config",
}

def wiring(path):
    """{event: set(hook basenames)} and the raw commands."""
    d = json.load(open(path))
    ev_map, cmds = {}, []
    for ev, arr in (d.get("hooks") or {}).items():
        for m in arr:
            for c in m.get("hooks", []):
                cmd = c.get("command", "")
                cmds.append(cmd)
                for b in re.findall(r"([A-Za-z0-9_\-]+\.sh)", cmd):
                    ev_map.setdefault(ev, set()).add(b)
    return ev_map, cmds

print("F1. registries agree")
wired = {}
for path, label in REGISTRIES.items():
    if not os.path.exists(path):
        check(False, f"{path} exists", f"({label})")
        continue
    try:
        wired[path] = wiring(path)
    except Exception as e:
        check(False, f"{path} parses", repr(e))
ref = wired.get("hooks/hooks.json", ({}, []))[0]
for path, (ev_map, _) in wired.items():
    if path == "hooks/hooks.json":
        continue
    same = {k: sorted(v) for k, v in ev_map.items()} == {k: sorted(v) for k, v in ref.items()}
    diff = ""
    if not same:
        for ev in sorted(set(ev_map) | set(ref)):
            a, b = ev_map.get(ev, set()), ref.get(ev, set())
            if a != b:
                diff += f"{ev}: +{sorted(a - b)} -{sorted(b - a)} "
    check(same, f"{path} == hooks/hooks.json", diff.strip())
print()

print("F2. no silent orphans")
wired_names = set().union(*ref.values()) if ref else set()
for f in sorted(glob.glob("hooks/*.sh")):
    b = os.path.basename(f)
    head = open(f, encoding="utf-8", errors="replace").read(4000)
    if b in wired_names:
        check(True, f"{b}", "wired")
    else:
        check("OPT-IN HELPER" in head, f"{b}", "not wired → header must say OPT-IN HELPER")
print()

print("F3. wired hooks exist, parse, are executable, have contract points")
harness = open("hooks/tests/hook_contract_test.sh", encoding="utf-8").read()
for b in sorted(wired_names):
    f = os.path.join("hooks", b)
    if not os.path.exists(f):
        check(False, f"{b} exists")
        continue
    r = subprocess.run(["bash", "-n", f], capture_output=True, text=True)
    check(r.returncode == 0, f"{b} bash -n", r.stderr.strip()[:80])
    check(os.access(f, os.X_OK), f"{b} executable")
    check(b in harness, f"{b} has contract points")
print()

print("F4. registry commands go through bash")
for path, (_, cmds) in wired.items():
    bad = [c for c in cmds if not c.lstrip().startswith("bash ")]
    check(not bad, f"{path}", f"not via bash: {bad[:1]}" if bad else "")
print()

print(f"FACTS {PASS} {FAIL}")
sys.exit(0 if FAIL == 0 else 1)
PY
PY_RC=$?

echo "F5. hook contract harness is green"
if [ "${CONTRACT_FACTS_SKIP_HARNESS:-0}" = "1" ]; then
  # `agent-kit test` runs hook_contract_test.sh itself right before this script;
  # skip the second (identical) run there.
  echo "  skip hook_contract_test.sh (CONTRACT_FACTS_SKIP_HARNESS=1 — run by the caller)"
  HARNESS_RC=0
  CP_LINE="skipped"
else
  HARNESS_OUT="$(bash "${HERE}/hook_contract_test.sh" 2>&1)"
  HARNESS_RC=$?
  CP_LINE="$(printf '%s\n' "${HARNESS_OUT}" | grep 'contract points:' | tail -1)"
fi
if [ "${HARNESS_RC}" -eq 0 ] && [ -n "${CP_LINE}" ]; then
  echo "  ok   hook_contract_test.sh                                        ${CP_LINE}"
  H_FAIL=0
else
  echo "  DEVIATING  hook_contract_test.sh                                  rc=${HARNESS_RC} ${CP_LINE}"
  H_FAIL=1
fi
echo
echo "─────────────────────────────────────────────"
if [ "${PY_RC}" -ne 0 ] || [ "${H_FAIL}" -ne 0 ]; then
  echo "contract facts: DEVIATING — fix the registry, the header or the hook (do not relax the case)."
  exit 1
fi
echo "contract facts: all ok"
exit 0
