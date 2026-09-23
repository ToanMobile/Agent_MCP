#!/usr/bin/env python3
"""profile_skills.py — skills a profile installs into a project (P1-5).

Usage: profile_skills.py <profile-id | none>
Prints one allowed skill name per line (every skill in skills/ when the profile is
"none" or declares no filter). A profile.json may declare:
  "skills":         [...]  allowlist — only these skills are installed
  "exclude_skills": [...]  denylist  — every skill except these
Unknown skill names in either list are reported on stderr and exit code 1.
"""

import json
import sys
from pathlib import Path

DEVKIT = Path(__file__).resolve().parent.parent


def all_skills():
    return sorted(p.name for p in (DEVKIT / "skills").iterdir() if (p / "SKILL.md").is_file())


def allowed_skills(profile_id):
    skills = all_skills()
    if not profile_id or profile_id == "none":
        return skills, []
    meta_file = DEVKIT / "profiles" / profile_id / "profile.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}
    allow, deny = meta.get("skills"), meta.get("exclude_skills") or []
    unknown = [s for s in (allow or []) + deny if s not in skills]
    if allow is not None:
        return [s for s in skills if s in allow], unknown
    return [s for s in skills if s not in deny], unknown


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    allowed, unknown = allowed_skills(argv[1])
    for name in unknown:
        print(f"profile_skills: unknown skill '{name}' in profiles/{argv[1]}/profile.json", file=sys.stderr)
    print("\n".join(allowed))
    return 1 if unknown else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
