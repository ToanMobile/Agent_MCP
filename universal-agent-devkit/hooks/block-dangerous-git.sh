#!/bin/bash
# block-dangerous-git.sh — PreToolUse guard cho Bash tool.
# Adapted từ mattpocock/skills (git-guardrails-claude-code).
# CHỈ chặn lệnh git KHÓ REVERSE / mất việc; CHO PHÉP `git push` thường
# (User thường chủ động yêu cầu push — CLAUDE.md: commit/push khi User yêu cầu).
# Contract: exit 2 + stderr = chặn tool call và trả lý do cho model; exit 0 = cho chạy.
# Bypass khi cần thật: User tự gõ lệnh qua prefix `!` trong prompt.
#
# How it decides (2026-09-23 rewrite — the regex-over-raw-text version was bypassed
# by `git -C . clean -fdx`, `\`-newline continuations and nested quotes, and blocked
# harmless chains like `git checkout main && rm -rf node_modules`):
#   1. Tokenize the command like a shell (python shlex) and split it into simple
#      commands on ; && || | & and newlines.
#   2. For each simple command whose program is git (after env assignments and
#      wrappers like `command`, `env`, `sudo`, `nohup`, `time`), skip git's global
#      options (-C dir, -c k=v, --git-dir=…, --no-pager, …) to find the real
#      subcommand, then check that subcommand's arguments.
#   3. `bash|sh|zsh -c STR`, `eval STR`, `ssh host STR`, `xargs CMD`, `watch CMD`,
#      `find … -exec CMD \;` are analysed recursively; `python|node|perl -c/-e STR`
#      is scanned with the raw regex. Quoted text passed to anything else
#      (echo, commit -m) is data.
#   3b. (2026-09-23 QA K-1/K-2) `( )`, `{ }` and shell keywords (if/then/do/!) split
#      or prefix commands; wrapper option VALUES are skipped (`sudo -u root`,
#      `nice -n 5`, `timeout 5`); `$var` in command position is treated as git;
#      `git -c alias.x=VAL x` checks VAL. Also blocked: `rm -f`, `rebase`,
#      `switch -C`, `checkout -B`. `restore --staged` (index only) is allowed.
#      Not a full shell parser: indirection through files/functions is out of scope.
#   4. FAIL-CLOSED: if the command can't be tokenized, or contains `$(`/backticks
#      whose output could become a command, the raw text is scanned with a broad
#      regex instead. Missing python3 blocks.

INPUT=$(cat)
if ! command -v python3 >/dev/null 2>&1; then
  echo "BLOCKED: block-dangerous-git.sh cần 'python3' để phân tích lệnh. Chặn để an toàn." >&2
  exit 2
fi

printf '%s' "$INPUT" | python3 -c '
import json, re, shlex, sys

try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command") or ""
except Exception:
    print("BLOCKED: block-dangerous-git.sh không đọc được JSON đầu vào. Chặn để an toàn.", file=sys.stderr)
    sys.exit(2)
if not isinstance(cmd, str) or not cmd.strip():
    sys.exit(0)

SEPARATORS = {";", "&&", "||", "|", "&", "\n", ";;", "|&", "(", ")", "{", "}", "((", "))"}
# Shell reserved words that may precede a command in the same simple-command slot
# (`if git reset --hard; then …`, `! git …`, `do git …`). Skipped, not analysed.
KEYWORDS = {"if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "time"}
# wrapper -> (options that take a separate value, number of positional args before the command)
WRAPPERS = {
    "command": (set(), 0), "builtin": (set(), 0), "exec": ({"-a"}, 0), "nohup": (set(), 0),
    "time": (set(), 0), "caffeinate": ({"-t", "-w"}, 0), "setsid": (set(), 0), "unbuffer": (set(), 0),
    "sudo": ({"-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T"}, 0),
    "doas": ({"-u", "-C"}, 0),
    "nice": ({"-n"}, 0),
    "ionice": ({"-c", "-n", "-p"}, 0),
    "stdbuf": ({"-i", "-o", "-e"}, 0),
    "timeout": ({"-s", "-k", "--signal", "--kill-after"}, 1),
    "chrt": (set(), 1),
    "taskset": (set(), 1),
    "flock": ({"-w", "-E", "--timeout"}, 1),
}
INTERPRETERS = {"python", "python2", "python3", "node", "perl", "ruby", "php", "deno", "bun"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "fish"}
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"}

def short_flags(args):
    """Letters of every single-dash short-option cluster, e.g. -xdf -> {x,d,f}."""
    out = set()
    for a in args:
        if a.startswith("-") and not a.startswith("--") and len(a) > 1:
            out.update(a[1:])
    return out

def danger_in_git(sub, args):
    long_ = set(a.split("=", 1)[0] for a in args if a.startswith("--"))
    short = short_flags(args)
    pos = [a for a in args if not a.startswith("-")]
    if sub == "reset" and long_ & {"--hard", "--merge", "--keep"}:
        return "reset --hard/--merge/--keep vứt thay đổi"
    if sub == "clean" and ("f" in short or "--force" in long_):
        return "clean --force xoá file chưa track"
    if sub == "branch" and ("D" in short or (("d" in short or "--delete" in long_) and ("f" in short or "--force" in long_))):
        return "branch -D xoá branch chưa merge"
    if sub in ("checkout", "switch"):
        if "f" in short or long_ & {"--force", "--discard-changes"}:
            return f"{sub} --force vứt thay đổi local"
        if sub == "checkout" and ("--" in args or "." in pos):
            return "checkout -- <path> vứt thay đổi working tree"
        if (sub == "checkout" and "B" in short) or (sub == "switch" and ("C" in short or "--force-create" in long_)):
            return f"{sub} -B/-C ghi đè branch đã có"
    if sub == "restore":
        staged_only = ("--staged" in long_ or "S" in short) and not ("--worktree" in long_ or "W" in short)
        if not staged_only:
            return "restore vứt thay đổi working tree"
    if sub == "rm" and ("f" in short or "--force" in long_):
        return "rm --force xoá file kèm thay đổi chưa commit"
    if sub == "rebase" and not long_ & {"--abort", "--continue", "--skip", "--quit", "--show-current-patch", "--edit-todo"}:
        return "rebase viết lại lịch sử branch"
    if sub == "push":
        if "f" in short or "d" in short or long_ & {"--force", "--force-with-lease", "--force-if-includes", "--delete", "--mirror", "--prune"}:
            return "push --force/--delete/--mirror ghi đè hoặc xoá trên remote"
        if any(a.startswith("+") or a.startswith(":") for a in pos):
            return "push +refspec / :ref ghi đè hoặc xoá trên remote"
    if sub == "stash" and pos[:1] and pos[0] in ("drop", "clear"):
        return "stash drop/clear mất stash"
    if sub == "reflog" and pos[:1] and pos[0] in ("expire", "delete"):
        return "reflog expire/delete mất lịch sử khôi phục"
    if sub == "gc" and any(a.startswith("--prune") for a in args):
        return "gc --prune xoá object không còn tham chiếu"
    if sub == "update-ref" and ("d" in short or "--delete" in long_):
        return "update-ref -d xoá ref"
    if sub in ("filter-branch", "filter-repo"):
        return f"{sub} viết lại lịch sử"
    if sub == "worktree" and pos[:1] == ["remove"] and ("f" in short or "--force" in long_):
        return "worktree remove --force mất thay đổi"
    return None

def skip_wrapper(tokens, i, prog):
    opts_arg, npos = WRAPPERS[prog]
    i += 1
    while i < len(tokens) and tokens[i].startswith("-") and tokens[i] != "--":
        opt = tokens[i].split("=", 1)[0]
        i += 2 if (opt in opts_arg and "=" not in tokens[i]) else 1
    if i < len(tokens) and tokens[i] == "--":
        i += 1
    if prog == "nice" and i < len(tokens) and re.match(r"^-?\d+$", tokens[i]):
        i += 1
    return i + npos

def git_danger_from_alias(val):
    """`git -c alias.x=VAL x`: VAL is either `!shell cmd` or git args."""
    if val.startswith("!"):
        return analyse(val[1:], 1)
    try:
        parts = shlex.split(val)
    except ValueError:
        return "alias git không phân tích được"
    return danger_in_git(parts[0], parts[1:]) if parts else None

def analyse_simple(tokens, depth):
    i = 0
    while i < len(tokens) and (tokens[i] in KEYWORDS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[i])):
        i += 1
    while i < len(tokens):
        prog = tokens[i].rsplit("/", 1)[-1]
        if prog == "env":
            i += 1
            while i < len(tokens) and (tokens[i].startswith("-") or "=" in tokens[i]):
                i += 2 if tokens[i] in ("-u", "-C", "-S") else 1
        elif prog in WRAPPERS:
            i = skip_wrapper(tokens, i, prog)
        elif tokens[i] in KEYWORDS:
            i += 1
        else:
            break
    if i >= len(tokens):
        return None
    prog, rest = tokens[i].rsplit("/", 1)[-1], tokens[i + 1:]
    # `$g reset --hard` / `${GIT} clean -f`: a variable in command position may be git.
    if prog.startswith("$"):
        return danger_in_git(rest[0], rest[1:]) if rest else None
    if prog in INTERPRETERS:
        for j, a in enumerate(rest):
            if a in ("-c", "-e", "--eval", "-E", "-r") and j + 1 < len(rest):
                m = RAW.search(rest[j + 1])
                return f"{m.group(1).split()[0]} (gọi qua {prog} {a})" if m else None
        return None
    if prog == "watch":
        j = 0
        while j < len(rest) and rest[j].startswith("-"):
            j += 2 if rest[j] in ("-n", "-d", "--interval") else 1
        return analyse(" ".join(rest[j:]), depth + 1) if j < len(rest) else None
    if prog == "find":
        for j, a in enumerate(rest):
            if a in ("-exec", "-execdir", "-ok", "-okdir"):
                sub = []
                for t in rest[j + 1:]:
                    if t in (";", "+"):
                        break
                    sub.append(t)
                reason = analyse_simple(sub, depth + 1)
                if reason:
                    return reason
        return None
    if prog in SHELLS or prog == "eval":
        if prog == "eval":
            return analyse(" ".join(rest), depth + 1)
        for j, a in enumerate(rest):
            if a == "-c" or (a.startswith("-") and not a.startswith("--") and "c" in a[1:]):
                return analyse(rest[j + 1], depth + 1) if j + 1 < len(rest) else None
        return None
    if prog == "ssh":
        j = 0
        while j < len(rest) and rest[j].startswith("-"):
            j += 2 if rest[j] in ("-p", "-i", "-l", "-o", "-F", "-J", "-L", "-R", "-D") else 1
        return analyse(" ".join(rest[j + 1:]), depth + 1) if j + 1 < len(rest) else None
    if prog == "xargs":
        j = 0
        while j < len(rest) and rest[j].startswith("-"):
            j += 2 if rest[j] in ("-I", "-n", "-P", "-L", "-d", "-E", "-s") else 1
        return analyse_simple(rest[j:], depth + 1)
    if prog != "git":
        return None
    j = 0
    aliases = {}
    while j < len(rest) and rest[j].startswith("-"):
        opt = rest[j].split("=", 1)[0]
        if opt == "-c" and j + 1 < len(rest) and rest[j + 1].startswith("alias.") and "=" in rest[j + 1]:
            k, v = rest[j + 1].split("=", 1)
            aliases[k[len("alias."):]] = v
        j += 2 if (opt in GIT_OPTS_WITH_ARG and "=" not in rest[j]) else 1
    if j >= len(rest):
        return None
    if rest[j] in aliases:
        reason = git_danger_from_alias(aliases[rest[j]])
        if reason:
            return f"alias {rest[j]} → {reason}"
    return danger_in_git(rest[j], rest[j + 1:])

RAW = re.compile(
    r"\bgit\b[^;&|\n]*?\s(reset\s+[^;&|\n]*--(hard|merge|keep)"
    r"|clean\s+[^;&|\n]*(-[A-Za-z]*f|--force)"
    r"|branch\s+[^;&|\n]*-D"
    r"|(checkout|switch)\s+[^;&|\n]*(\s-[A-Za-z]*f\b|--force|--discard-changes|\s--(\s|$)|\s\.(\s|$))"
    r"|restore\b(?![^;&|\n]*(--staged|\s-S\b))"
    r"|rm\s+[^;&|\n]*(-[A-Za-z]*f\b|--force)|rebase\b(?!\s+--(abort|continue|skip|quit))"
    r"|switch\s+[^;&|\n]*-C\b|checkout\s+[^;&|\n]*-B\b"
    r"|push\s+[^;&|\n]*(\s-[A-Za-z]*[fd]\b|--force|--delete|--mirror|--prune|\s[+:][^\s])"
    r"|stash\s+(drop|clear)|reflog\s+(expire|delete)|gc\s+[^;&|\n]*--prune|update-ref\s+[^;&|\n]*-d\b"
    r"|filter-branch|filter-repo)")

def analyse(text, depth=0):
    if depth > 5:
        return "lồng lệnh quá sâu để phân tích"
    text = text.replace("\\\n", " ").replace("\n", " ; ")
    if "`" in text or "$(" in text or "<(" in text:
        m = RAW.search(text)
        return f"{m.group(1).split()[0]} (trong lệnh có $(...)/backtick)" if m else None
    try:
        lex = shlex.shlex(text, posix=True, punctuation_chars=";&|()")
        lex.whitespace = " \t\r"
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        m = RAW.search(text)
        return f"{m.group(1).split()[0]} (lệnh không phân tích được)" if m else None
    segment = []
    for tok in tokens + [";"]:
        if tok in SEPARATORS or set(tok) <= set(";&|\n()"):
            if segment:
                reason = analyse_simple(segment, depth)
                if reason:
                    return reason
            segment = []
        else:
            segment.append(tok)
    return None

reason = analyse(cmd)
if reason:
    print(f"BLOCKED: {cmd!r} — {reason}. User đã chặn thao tác git khó revert này. "
          "Nếu thực sự cần, User sẽ tự chạy qua prefix \"!\".", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
'
