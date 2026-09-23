#!/usr/bin/env bash
# test_repo_consistency.sh — the repo agrees with itself and with what its docs claim.
#
#   R1  no absolute symlinks, no broken symlinks
#   R2  every *.json parses
#   R3  every *.sh passes `bash -n`; a shebang means the file is executable and an
#       executable .sh/.py has a shebang
#   R4  strict YAML frontmatter for skills/*/SKILL.md and agents/**/*.md: `name`
#       (= directory name for skills), `description` <= 1024 chars, no duplicate names
#   R5  every `/command` quoted in README.md, README.vi.md, AGENTS.md exists in commands/,
#       every commands/*.md is linked (relative) from .claude/commands/
#   R6  every profile's active_councils and essential_mcps exist; every profile
#       regression_matrix.json uses the rules/watch_files schema post-fix-gate reads
#   R7  counts written in the docs (skills, profiles, councils, hooks) equal the real
#       counts, and retired claims ("8-layer", "AST linter", "50 agents", fixed test
#       totals) are gone
#   R8  no references to files of another repo (.Codex/, rulebook/NN-…)
#
# Red means a doc, a file or a link is wrong: fix that, do not relax the check.
# Usage: bash tests/test_repo_consistency.sh      (needs python3; uses ruby for YAML if present)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "test_repo_consistency.sh: python3 is required" >&2
  exit 1
fi

python3 - "$ROOT" <<'PY'
import glob, json, os, re, shutil, subprocess, sys

ROOT = sys.argv[1]
PASS = FAIL = 0
def check(ok, name, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"✔ {name}")
    else:
        FAIL += 1
        print(f"✘ {name}" + (f"\n    {detail}" if detail else ""))

SKIP_DIRS = {".git", "node_modules", "__pycache__"}
def walk():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for n in dns + fns:
            yield os.path.join(dp, n)

def rel(p):
    return os.path.relpath(p, ROOT)

# ── R1 symlinks ────────────────────────────────────────────────────────────────
abs_links, broken = [], []
for p in walk():
    if os.path.islink(p):
        t = os.readlink(p)
        if t.startswith("/"):
            abs_links.append(f"{rel(p)} -> {t}")
        elif not os.path.exists(p):
            broken.append(f"{rel(p)} -> {t}")
check(not abs_links, "R1 no absolute symlinks", "; ".join(abs_links[:5]))
check(not broken, "R1 no broken symlinks", "; ".join(broken[:5]))

# ── R2 JSON ────────────────────────────────────────────────────────────────────
bad_json = []
for p in walk():
    if p.endswith(".json") and os.path.isfile(p):
        try:
            json.load(open(p, encoding="utf-8"))
        except Exception as e:
            bad_json.append(f"{rel(p)}: {e}")
check(not bad_json, "R2 every JSON file parses", "; ".join(bad_json[:5]))

# ── R3 shell syntax & executable bits ─────────────────────────────────────────
syntax, bits = [], []
for p in walk():
    if os.path.islink(p) or not os.path.isfile(p):
        continue
    if p.endswith(".sh"):
        r = subprocess.run(["bash", "-n", p], capture_output=True, text=True)
        if r.returncode != 0:
            syntax.append(f"{rel(p)}: {r.stderr.strip()[:120]}")
    if p.endswith((".sh", ".py")):
        with open(p, "rb") as fh:
            shebang = fh.read(2) == b"#!"
        exe = os.access(p, os.X_OK)
        if shebang and not exe:
            bits.append(f"{rel(p)}: shebang but not executable")
        elif exe and not shebang:
            bits.append(f"{rel(p)}: executable without shebang")
check(not syntax, "R3 every .sh passes bash -n", "; ".join(syntax[:5]))
check(not bits, "R3 executable bit matches shebang", "; ".join(bits[:8]))

# ── R4 frontmatter ─────────────────────────────────────────────────────────────
RUBY = shutil.which("ruby")
def frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None, "no frontmatter block"
    block = m.group(1)
    if RUBY:
        r = subprocess.run(
            [RUBY, "-ryaml", "-rjson", "-e",
             "d = YAML.safe_load(STDIN.read); puts JSON.generate(d.is_a?(Hash) ? d : {'__not_a_map__' => true})"],
            input=block, capture_output=True, text=True)
        if r.returncode != 0:
            return None, "YAML: " + r.stderr.strip().splitlines()[-1][:160]
        data = json.loads(r.stdout)
        if "__not_a_map__" in data:
            return None, "frontmatter is not a mapping"
        return data, None
    # Fallback (no ruby): one `key: value` per line; an unquoted plain value must not
    # contain ": " or " #" (YAML would reject or truncate it).
    data = {}
    for line in block.splitlines():
        if not line.strip() or line.startswith((" ", "\t", "-")):
            continue
        k, sep, v = line.partition(":")
        if not sep:
            return None, f"not a key/value line: {line[:60]}"
        v = v.strip()
        if v[:1] in "\"'":
            v = v[1:-1]
        elif ": " in v or " #" in v:
            return None, f"unquoted value of '{k}' contains ': ' or ' #'"
        data[k.strip()] = v
    return data, None

def check_frontmatter(files, label, name_must_match_dir):
    problems, names = [], {}
    for f in files:
        data, err = frontmatter(f)
        if err:
            problems.append(f"{rel(f)}: {err}")
            continue
        name, desc = data.get("name"), data.get("description")
        if not name:
            problems.append(f"{rel(f)}: missing name")
        if not desc:
            problems.append(f"{rel(f)}: missing description")
        elif len(str(desc)) > 1024:
            problems.append(f"{rel(f)}: description {len(str(desc))} > 1024 chars")
        if name_must_match_dir and name and name != os.path.basename(os.path.dirname(f)):
            problems.append(f"{rel(f)}: name '{name}' != directory")
        if name:
            names.setdefault(name, []).append(rel(f))
    dups = {n: fs for n, fs in names.items() if len(fs) > 1}
    check(not problems, f"R4 {label}: valid frontmatter", "; ".join(problems[:6]))
    check(not dups, f"R4 {label}: unique names", str(dups)[:300])

skill_files = sorted(glob.glob(os.path.join(ROOT, "skills/*/SKILL.md")))
agent_files = sorted(glob.glob(os.path.join(ROOT, "agents/**/*.md"), recursive=True))
check_frontmatter(skill_files, "skills", True)
check_frontmatter(agent_files, "agents", False)

# ── R5 slash commands ──────────────────────────────────────────────────────────
# Built-in agent commands the docs may mention; they are not DevKit commands.
BUILTINS = {"help", "clear", "compact", "config", "init", "model", "memory", "cost",
            "doctor", "login", "logout", "status", "hooks", "agents", "mcp", "permissions",
            "resume", "exit", "plugin", "code-review", "security-review"}
DOCS = ["README.md", "README.vi.md", "AGENTS.md"]
cmd_re = re.compile(r"`(/[a-z][a-z0-9-]*)(?=[`\s\[])")
missing = []
for d in DOCS:
    text = open(os.path.join(ROOT, d), encoding="utf-8").read()
    for m in cmd_re.finditer(text):
        name = m.group(1)[1:]
        if name in BUILTINS:
            continue
        if not os.path.exists(os.path.join(ROOT, "commands", name + ".md")):
            missing.append(f"{d}: /{name}")
check(not missing, "R5 every documented /command exists in commands/", "; ".join(sorted(set(missing))[:10]))

unlinked = []
for c in sorted(glob.glob(os.path.join(ROOT, "commands/*.md"))):
    link = os.path.join(ROOT, ".claude/commands", os.path.basename(c))
    if not os.path.islink(link) or os.readlink(link).startswith("/") or not os.path.exists(link):
        unlinked.append(os.path.basename(c))
check(not unlinked, "R5 every command is linked (relative) from .claude/commands/", ", ".join(unlinked[:10]))

sync = open(os.path.join(ROOT, "scripts/sync_commands.sh"), encoding="utf-8").read()
alias_missing = [a for a in re.findall(r'^\s*"([a-z0-9-]+):[a-z0-9-]+"\s*$', sync, re.M)
                 if not os.path.exists(os.path.join(ROOT, "commands", a + ".md"))]
check(not alias_missing, "R5 every alias in sync_commands.sh has commands/<alias>.md", ", ".join(alias_missing))

# /review collides with the agent's built-in /review: commands/review.md may only be the
# deprecated redirect stub (never a live link to a skill). Same for every deprecated alias.
MARKER = "<!-- devkit:deprecated-alias -->"
dep_block = re.search(r"DEPRECATED_ALIASES=\((.*?)\)", sync, re.S)
deprecated = re.findall(r'"([a-z0-9-]+):', dep_block.group(1)) if dep_block else []
bad_dep = []
for name in sorted(set(deprecated) | {"review"}):
    p = os.path.join(ROOT, "commands", name + ".md")
    if not os.path.lexists(p):
        continue
    if os.path.islink(p) or MARKER not in open(p, encoding="utf-8").read():
        bad_dep.append(name)
check("review" in deprecated and not bad_dep,
      "R5 commands/review.md is only a deprecated stub; deprecated aliases are stubs",
      ", ".join(bad_dep) or "review missing from DEPRECATED_ALIASES")

# ── R6 profiles ────────────────────────────────────────────────────────────────
mcp_names = set()
for f in ("mcp/.mcp.json", "mcp/mcp_config.json"):
    mcp_names |= set(json.load(open(os.path.join(ROOT, f)))["mcpServers"])
prof_problems = []
profiles = sorted(d for d in os.listdir(os.path.join(ROOT, "profiles"))
                  if os.path.isfile(os.path.join(ROOT, "profiles", d, "profile.json")))
for pid in profiles:
    meta = json.load(open(os.path.join(ROOT, "profiles", pid, "profile.json")))
    for c in meta.get("active_councils", []):
        if not (os.path.isfile(os.path.join(ROOT, "agents/councils", c))
                or os.path.isfile(os.path.join(ROOT, "profiles", pid, "councils", c))):
            prof_problems.append(f"{pid}: council {c} missing")
    for m in meta.get("essential_mcps", []):
        if m not in mcp_names:
            prof_problems.append(f"{pid}: MCP '{m}' not defined in mcp/")
    for k in ("rules_file", "regression_matrix"):
        if meta.get(k) and not os.path.isfile(os.path.join(ROOT, meta[k])):
            prof_problems.append(f"{pid}: {k} {meta[k]} missing")
check(not prof_problems, "R6 profile councils, MCPs, rules and matrices exist", "; ".join(prof_problems[:6]))

# Every profile matrix uses the schema post-fix-gate reads (bin/post-fix-gate.py TIA
# layer: matrix["rules"][*].component / watch_files / mandatory_regression_tests[*].id,
# .command). Any other shape (e.g. a "checklist" list) is silently ignored by the gate.
matrix_problems = []
for mf in sorted(glob.glob(os.path.join(ROOT, "profiles", "*", "regression_matrix.json"))):
    rel = os.path.relpath(mf, ROOT)
    try:
        m = json.load(open(mf))
    except Exception as e:
        matrix_problems.append(f"{rel}: {e}"); continue
    rules = m.get("rules")
    if not isinstance(rules, list) or not rules:
        matrix_problems.append(f"{rel}: no non-empty 'rules' list (keys: {sorted(m)})"); continue
    for i, r in enumerate(rules):
        if not r.get("component"):
            matrix_problems.append(f"{rel}: rules[{i}] has no component")
        if not (isinstance(r.get("watch_files"), list) and r["watch_files"]):
            matrix_problems.append(f"{rel}: rules[{i}] has no watch_files")
        tests_ = r.get("mandatory_regression_tests")
        if not (isinstance(tests_, list) and tests_):
            matrix_problems.append(f"{rel}: rules[{i}] has no mandatory_regression_tests"); continue
        for t in tests_:
            if not (t.get("id") and t.get("command")):
                matrix_problems.append(f"{rel}: rules[{i}] test without id/command")
            elif re.search(r"\|\|\s*true\s*$", t["command"]):
                matrix_problems.append(f"{rel}: {t['id']} ends in '|| true' (can never fail)")
check(not matrix_problems, "R6 every profile regression_matrix.json has the schema the gate reads",
      "; ".join(matrix_problems[:6]))

# ── R7 documented counts ───────────────────────────────────────────────────────
n_skills = len(skill_files)
n_profiles = len(profiles)
n_councils = len(glob.glob(os.path.join(ROOT, "agents/councils/*.md")))
n_hook_files = len(glob.glob(os.path.join(ROOT, "hooks/*.sh")))
wired = set()
for ev in json.load(open(os.path.join(ROOT, "hooks/hooks.json")))["hooks"].values():
    for matcher in ev:
        for h in matcher["hooks"]:
            wired.add(re.findall(r"([\w.-]+\.sh)", h["command"])[-1])
n_wired = len(wired)
print(f"  (real counts: {n_skills} skills, {n_profiles} profiles, {n_councils} councils, "
      f"{n_hook_files} hook scripts, {n_wired} wired hooks)")

COUNT_DOCS = ["README.md", "README.vi.md", "AGENTS.md", "CLAUDE.md", ".claude-plugin/plugin.json",
              "rules/core-rules.md", "bin/agent-kit", "Makefile"]
N = r"(\d+)\s*"
RULES = [
    ("skills",   re.compile(N + r"(?:curated\s+|canonical\s+|engineering\s+)*(?:skills?|kỹ năng)\b", re.I), {n_skills}),
    ("skills",   re.compile(r"Skills-(\d+)"), {n_skills}),
    ("profiles", re.compile(N + r"(?:dynamic\s+|domain\s+)*(?:profiles?)\b", re.I), {n_profiles}),
    ("profiles", re.compile(r"Profiles-(\d+)"), {n_profiles}),
    ("councils", re.compile(N + r"(?:quality\s+|audit\s+)*(?:councils?|hội đồng)", re.I), {n_councils}),
    ("hooks",    re.compile(N + r"(?:lifecycle\s+|safety\s+)*(?:hook scripts|hooks?|safety gates)\b", re.I), {n_hook_files, n_wired}),
    ("hooks",    re.compile(N + r"(?:wired|registered)\b", re.I), {n_wired}),
]
RETIRED = [r"8[- ]layer", r"8 tầng", r"8 lớp", r"5[- ]layer", r"5 tầng", r"AST (?:machine )?linter",
           r"50[- ](?:specialized |audit )?agents?", r"50 agent", r"\b302\b", r"\b294\b",
           r"168 (?:contract|hook)", r"160 / 160", r"44 curated", r"file://", r"Windsurf", r"Copilot",
           r"100/100 HEALTHY", r"cryptographically signed"]
wrong, retired = [], []
for d in COUNT_DOCS:
    path = os.path.join(ROOT, d)
    if not os.path.isfile(path):
        continue
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        for label, rx, allowed in RULES:
            for m in rx.finditer(line):
                if int(m.group(1)) not in allowed:
                    wrong.append(f"{d}:{i} '{m.group(0).strip()}' ({label}: real {sorted(allowed)})")
        for pat in RETIRED:
            if re.search(pat, line, re.I):
                retired.append(f"{d}:{i} /{pat}/")
check(not wrong, "R7 documented counts match the repo", "; ".join(wrong[:8]))
check(not retired, "R7 retired claims are gone", "; ".join(retired[:8]))

# ── R8 foreign-repo references ────────────────────────────────────────────────
foreign = []
scan = DOCS + ["CLAUDE.md"] + glob.glob(os.path.join(ROOT, "skills/*/SKILL.md")) \
    + glob.glob(os.path.join(ROOT, "agents/**/*.md"), recursive=True) \
    + glob.glob(os.path.join(ROOT, "rules/*.md")) + glob.glob(os.path.join(ROOT, "commands/*.md"))
for f in scan:
    path = f if os.path.isabs(f) else os.path.join(ROOT, f)
    if not os.path.isfile(path):
        continue
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        if re.search(r"\.Codex/|rulebook/\d", line):
            foreign.append(f"{rel(path)}:{i}")
check(not foreign, "R8 no .Codex/ or rulebook/NN references", "; ".join(sorted(set(foreign))[:8]))

print()
print(f"repo consistency: {PASS} passed, {FAIL} failed")
if FAIL == 0:
    print("repo consistency: all checks passed")
sys.exit(0 if FAIL == 0 else 1)
PY
