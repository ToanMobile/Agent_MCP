# Universal Agent DevKit Integration
This project is configured with Universal Agent DevKit standards:
- Central Engineering Rules & SSOT: @AGENTS.md
- Active Domain Profile: @.active-profile.json
- High-Performance & Security Standards: @rules/core-rules.md
- Post-Fix Verification Gate: `postfix-gate --run-tests` (installed on PATH by `make install` in the DevKit; without it: `python3 <DevKit dir>/bin/post-fix-gate.py --run-tests`). Only exit `0` counts as PASS.
