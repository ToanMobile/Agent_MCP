#!/usr/bin/env bash
# Regression test: bin/post-fix-gate.py must report only what it actually ran.
# - clean tree            -> exit 3, never PASS
# - impacted, dry-run     -> exit 2 (UNVERIFIED), never PASS
# - --run-tests, `false`  -> exit 1 (REJECT)
# - --run-tests, `true`   -> exit 0 (PASS)
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$DEVKIT_DIR/bin/post-fix-gate.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILS=0
check() { # name expected actual [output] [forbidden-substring]
  local name="$1" expected="$2" actual="$3" out="${4:-}" forbid="${5:-}"
  if [ "$actual" != "$expected" ]; then
    echo "✖ $name: exit $actual, expected $expected"; FAILS=$((FAILS + 1)); return
  fi
  if [ -n "$forbid" ] && printf '%s' "$out" | grep -q -- "$forbid"; then
    echo "✖ $name: output contains forbidden '$forbid'"; FAILS=$((FAILS + 1)); return
  fi
  echo "✔ $name"
}

make_repo() { # $1 = regression command
  rm -rf "$TMP/repo" && mkdir -p "$TMP/repo/src"
  cd "$TMP/repo" || exit 1
  git init -q . && git config user.email t@t && git config user.name t
  echo "fun ok() = 1" > src/Core.kt
  cat > matrix.json <<JSON
{"project":"t","rules":[{"component":"Core","watch_files":["src/Core.kt"],
 "mandatory_regression_tests":[{"id":"REG-1","name":"core","command":"$1"}]}]}
JSON
  git add -A && git commit -qm init
}

run_gate() {
  CLAUDE_PROJECT_DIR="$TMP/repo" python3 "$GATE" --matrix "$TMP/repo/matrix.json" "$@" 2>&1
}

make_repo "true"
out="$(run_gate --run-tests)"; check "clean tree is not PASS" 3 $? "$out" "PASS —"

echo "fun ok() = 2" > src/Core.kt
out="$(run_gate)"; check "dry-run default is UNVERIFIED" 2 $? "$out" "\[x\] PASS"
out="$(run_gate --dry-run --run-tests)"; check "--dry-run overrides --run-tests" 2 $? "$out" "\[x\] PASS"
out="$(run_gate --run-tests)"; check "passing regression command -> PASS" 0 $? "$out"
grep -q 'REG-1.*`PASS`' "$TMP/repo/.git/postfix-gate/last_report.md" \
  && echo "✔ report records real PASS" || { echo "✖ report missing REG-1 PASS"; FAILS=$((FAILS + 1)); }

make_repo "exit 7"
echo "fun ok() = 3" > src/Core.kt
out="$(run_gate --run-tests)"; check "failing regression command -> REJECT" 1 $? "$out" "\[x\] PASS"
printf '%s' "$out" | grep -q 'exit=7' \
  && echo "✔ real exit code reported" || { echo "✖ exit code 7 not reported"; FAILS=$((FAILS + 1)); }

# --- Changed-file discovery must not let content escape the scans -----------------
make_repo "true"
# Fake secrets are assembled at runtime so this file itself never matches the scanner.
mkdir -p newdir && printf '%s = "%s"\n' "api_""key" "ABCDEFGHIJKLMNOP" > newdir/secret.py
out="$(run_gate --run-tests --allow-no-tests)"; check "secret inside an untracked dir -> REJECT" 1 $? "$out"

make_repo "true"
printf '// ... existing code ...\n' > "src/sp ace.kt"
out="$(run_gate --run-tests --allow-no-tests)"; check "placeholder in a file name with a space -> REJECT" 1 $? "$out"

make_repo "true"
git mv src/Core.kt src/Renamed.kt && printf '// ... existing code ...\n' >> src/Renamed.kt
out="$(run_gate --run-tests --allow-no-tests)"; check "placeholder in a renamed file -> REJECT" 1 $? "$out"

# --- No regression coverage is not a PASS -------------------------------------------
make_repo "true"
echo "x" > other.txt
out="$(CLAUDE_PROJECT_DIR="$TMP/repo" python3 "$GATE" --run-tests 2>&1)"; check "no matrix -> UNVERIFIED" 2 $? "$out"
out="$(run_gate --run-tests)"; check "no matching regression test -> UNVERIFIED" 2 $? "$out"
out="$(run_gate --run-tests --allow-no-tests)"; check "--allow-no-tests accepts it" 0 $? "$out"
[ -z "$(git status --porcelain -- templates)" ] && echo "✔ report is not written into the audited tree" \
  || { echo "✖ report written into the working tree"; FAILS=$((FAILS + 1)); }

# --- Monorepo: project is a subdirectory of the git repo ----------------------------
make_repo "true"
mkdir -p sub/src && printf '// ... existing code ...\n' > sub/src/Core.kt
out="$(CLAUDE_PROJECT_DIR="$TMP/repo/sub" python3 "$GATE" --matrix "$TMP/repo/matrix.json" --run-tests --allow-no-tests 2>&1)"
check "placeholder in a monorepo subdir -> REJECT" 1 $? "$out"

# --- Timeout kills the whole process tree -------------------------------------------
make_repo "sleep 30 & echo \$! > $TMP/child.pid; wait"
echo "fun ok() = 9" > src/Core.kt
out="$(run_gate --run-tests --timeout 2)"; check "timeout -> REJECT" 1 $? "$out"
sleep 1
if kill -0 "$(cat "$TMP/child.pid" 2>/dev/null)" 2>/dev/null; then
  echo "✖ timed-out test left a child process running"; FAILS=$((FAILS + 1)); kill "$(cat "$TMP/child.pid")"
else echo "✔ timed-out test's child process was killed"; fi

expect_in() { # name substring output
  if printf '%s' "$3" | grep -q -- "$2"; then echo "✔ $1"; else echo "✖ $1: missing '$2'"; FAILS=$((FAILS + 1)); fi
}
expect_not_in() { # name substring output
  if printf '%s' "$3" | grep -q -- "$2"; then echo "✖ $1: contains '$2'"; FAILS=$((FAILS + 1)); else echo "✔ $1"; fi
}
gate_nomatrix() { CLAUDE_PROJECT_DIR="$TMP/repo" python3 "$GATE" --run-tests --allow-no-tests "$@" 2>&1; }

# --- G-1: the audited change must not be able to rewrite its own regression command -
make_repo "exit 1"
echo "fun ok() = 2" > src/Core.kt
sed -i.bak 's/exit 1/true/' matrix.json && rm -f matrix.json.bak
out="$(run_gate --run-tests)"; rc=$?
[ "$rc" -ne 0 ] && echo "✔ matrix edited in the same change is not PASS (exit $rc)" \
  || { echo "✖ matrix edited in the same change -> PASS"; FAILS=$((FAILS + 1)); }
expect_in "matrix tampering is reported" "bị sửa so với HEAD" "$out"

make_repo "true"
mkdir -p templates && cat > templates/regression_matrix.active.json <<'JSON'
{"project":"t","rules":[{"component":"Core","watch_files":["src/Core.kt"],
 "mandatory_regression_tests":[{"id":"REG-1","name":"core","command":"true"}]}]}
JSON
echo "fun ok() = 2" > src/Core.kt
out="$(CLAUDE_PROJECT_DIR="$TMP/repo" python3 "$GATE" --run-tests 2>&1)"
check "uncommitted default matrix -> UNVERIFIED" 2 $? "$out" "PASS —"

make_repo "true"
mkdir -p src/test && echo "assert(true)" > src/test/CoreTest.kt && git add -A && git commit -qm t
echo "fun ok() = 2" > src/Core.kt && echo "// weakened" > src/test/CoreTest.kt
out="$(run_gate --run-tests)"; check "existing test edited in the change -> UNVERIFIED" 2 $? "$out" "PASS —"
make_repo "true"
echo "fun ok() = 2" > src/Core.kt && mkdir -p src/test && echo "assert(ok() == 2)" > src/test/NewTest.kt
out="$(run_gate --run-tests)"; check "new RED test file is allowed -> PASS" 0 $? "$out"

# --- G-2: whitelisting is by exact template suffix, not by directory name ----------
make_repo "true"
mkdir -p app/sample-app && echo x > app/sample-app/release.jks
out="$(gate_nomatrix)"; check "sample-app/release.jks -> REJECT" 1 $? "$out"
make_repo "true"
mkdir -p templates/prod && echo x > templates/prod/server.key
out="$(gate_nomatrix)"; check "templates/prod/server.key -> REJECT" 1 $? "$out"
make_repo "true"
printf 'API_KEY=changeme\n' > .env.example
out="$(gate_nomatrix)"; check ".env.example with a placeholder -> PASS" 0 $? "$out"

# --- G-3: common secret shapes -------------------------------------------------------
secret_case() { # name file content
  make_repo "true"; mkdir -p "$(dirname "$2")"; printf '%s\n' "$3" > "$2"
  out="$(gate_nomatrix)"; check "$1 -> REJECT" 1 $? "$out"
}
secret_case "base64 password" src/Conf.kt "val password = \"Zx9/Qw+Er7Ty==\""
secret_case "AWS access key" src/Aws.kt "val id = \"AKI""AABCDEFGHIJKLMNOP\""
secret_case "GitHub token" src/Gh.kt "val ghToken = \"gh""p_abcdefghijklmnopqrstuvwxyz0123456789AB\""
secret_case "unquoted password in .properties" gradle.properties "pass""word = hunter2hunter2"
secret_case "secrets.env file" secrets.env "X=1"
make_repo "true"
printf '#!/bin/sh\n. ./.env\n' > run.sh
out="$(gate_nomatrix)"; check "sourcing ./.env in a script is not a secret" 0 $? "$out"
make_repo "true"
printf 'db.password=${DB_PASSWORD}\n' > app.properties
out="$(gate_nomatrix)"; check "env-var reference in .properties is not a secret" 0 $? "$out"

# --- G-4: "test" as a substring must not skip the scans ------------------------------
make_repo "true"
mkdir -p src/latest && printf 'fun f() { try { g() } catch (e: Exception) {} }\n' > src/latest/Foo.kt
out="$(gate_nomatrix)"; check "src/latest/Foo.kt is scanned -> REJECT" 1 $? "$out"
make_repo "true"
mkdir -p src/test && printf 'fun f() { try { g() } catch (e: Exception) {} }\n' > src/test/FooTest.kt
out="$(gate_nomatrix)"; check "src/test/FooTest.kt is a test -> PASS" 0 $? "$out"

# --- G-5: monorepo subproject uses its own paths and scope -------------------------
make_repo "true"
mkdir -p sub/src && echo "fun a() = 1" > sub/src/Core.kt
cat > sub/matrix.json <<'JSON'
{"project":"sub","rules":[{"component":"Core","watch_files":["src/Core.kt"],
 "mandatory_regression_tests":[{"id":"REG-S","name":"sub","command":"true"}]}]}
JSON
git add -A && git commit -qm sub
echo "fun a() = 2" > sub/src/Core.kt
out="$(CLAUDE_PROJECT_DIR="$TMP/repo/sub" python3 "$GATE" --matrix "$TMP/repo/sub/matrix.json" --run-tests 2>&1)"
check "monorepo subproject matches its matrix -> PASS" 0 $? "$out"
git checkout -q -- sub && echo "outside" > other.txt
out="$(CLAUDE_PROJECT_DIR="$TMP/repo/sub" python3 "$GATE" --run-tests 2>&1)"
check "change outside the subproject is out of scope" 3 $? "$out"

# --- G-6: no adb is "not verified", never "device online" ---------------------------
make_repo "true"
mkdir -p "$TMP/bin" app/android && ln -sf "$(command -v python3)" "$TMP/bin/python3" && ln -sf "$(command -v git)" "$TMP/bin/git"
echo "fun a() = 1" > app/android/A.kt
out="$(PATH="$TMP/bin" gate_nomatrix)"
expect_not_in "no adb -> no 'device online' claim" "có thiết bị online" "$out"
expect_in "no adb -> reported as not verified" "KHÔNG xác minh được" "$out"

# --- G-8: proof images of other projects' sessions are not counted -----------------
make_repo "true"
echo "fun ok() = 2" > src/Core.kt
BR="$TMP/brain" && rm -rf "$BR" && mkdir -p "$BR/other" "$BR/mine"
echo "work in /somewhere/else" > "$BR/other/walkthrough.md"; : > "$BR/other/a.png"; : > "$BR/other/b.png"
out="$(POSTFIX_GATE_BRAIN_DIR="$BR" run_gate --run-tests)"
expect_in "other project's images are ignored" "0 ảnh" "$out"
expect_in "no session of this project -> not verified" "không có phiên nào" "$out"
echo "edited $(cd "$TMP/repo" && pwd -P)/src/Core.kt" > "$BR/mine/walkthrough.md"; echo img > "$BR/mine/p.png"
out="$(POSTFIX_GATE_BRAIN_DIR="$BR" run_gate --run-tests)"
expect_in "this project's session images are counted" "1 ảnh" "$out"

# --- G-9: --diff cannot smuggle git options ------------------------------------------
make_repo "true"
echo "fun ok() = 2" > src/Core.kt
out="$(run_gate --run-tests "--diff=--output=$TMP/pwned")"; check "--diff=--output=... is refused" 2 $? "$out"
[ ! -e "$TMP/pwned" ] && echo "✔ git did not write the injected output file" \
  || { echo "✖ --diff option injection wrote a file"; FAILS=$((FAILS + 1)); }

# --- G-10: lessons are recorded only after a PASS, escaped ---------------------------
make_repo "exit 1"
echo "fun ok() = 2" > src/Core.kt
run_gate --run-tests --record-lesson "bad" >/dev/null 2>&1
[ ! -e .agents/instincts.md ] && echo "✔ REJECT does not record a lesson" \
  || { echo "✖ lesson recorded on REJECT"; FAILS=$((FAILS + 1)); }
make_repo "true"
echo "fun ok() = 2" > src/Core.kt
run_gate --run-tests --record-lesson "$(printf 'x\n# injected heading\n- item')" >/dev/null 2>&1
if [ -f .agents/instincts.md ] && ! grep -q '^# injected' .agents/instincts.md && ! grep -q '^- item' .agents/instincts.md \
   && grep -q 'INSTINCT-AUTO\] x \\# injected heading' .agents/instincts.md; then
  echo "✔ lesson recorded after PASS with Markdown escaped"
else echo "✖ lesson missing or not escaped"; FAILS=$((FAILS + 1)); fi

# --- O6: devkit-installed links are not user changes nor "unreadable" --------------
make_repo "true"
mkdir -p .claude/hooks .agents/skills
ln -s "$DEVKIT_DIR/hooks/claim_check.sh" .claude/hooks/claim_check.sh
ln -s "$DEVKIT_DIR/skills/qc" .agents/skills/qc
ln -s "$DEVKIT_DIR/rules" rules
out="$(gate_nomatrix)"; check "only devkit links -> nothing to audit" 3 $? "$out"
echo "fun ok() = 2" > src/Core.kt
out="$(gate_nomatrix)"; check "devkit links + real change -> PASS" 0 $? "$out" "không đọc được"

if [ "$FAILS" -ne 0 ]; then
  echo "post-fix-gate: $FAILS FAILED"; exit 1
fi
echo "post-fix-gate: all checks passed"
