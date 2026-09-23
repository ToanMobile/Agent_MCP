"""devkit_i18n — EN/VI output language for the DevKit CLIs (installer, profile, health, gate).

Language resolution (first match wins) — shared with scripts/i18n.sh:
  1. --lang on the command line
  2. $DEVKIT_LANG
  3. "lang" saved in <project>/.active-profile.json
  4. "vi" (default)

Messages live next to the code as `tr(vi, en)` pairs so a message and its
translation can never drift apart. Hooks (hooks/*.sh) are not covered.
"""

import json
import os
import re
from pathlib import Path

SUPPORTED = ("en", "vi")
DEFAULT_LANG = "vi"

# Vietnamese letters with diacritics (used by tests: EN output must contain none).
VI_CHARS = re.compile(
    "[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
    "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]")

_lang = None


def normalize(value):
    """'en', 'EN', 'en_US.UTF-8', 'vi-VN' → 'en' / 'vi'; anything else → None."""
    v = (value or "").strip().lower()
    v = re.split(r"[._\-]", v, maxsplit=1)[0] if v else ""
    return v if v in SUPPORTED else None


def lang_from_project(target):
    if not target:
        return None
    try:
        with open(Path(target) / ".active-profile.json", "r", encoding="utf-8") as f:
            return normalize(json.load(f).get("lang"))
    except (OSError, ValueError, AttributeError):
        return None


def resolve_lang(cli=None, target=None):
    return (normalize(cli) or normalize(os.environ.get("DEVKIT_LANG"))
            or lang_from_project(target) or DEFAULT_LANG)


def set_lang(lang):
    global _lang
    _lang = normalize(lang) or DEFAULT_LANG
    return _lang


def get_lang():
    return _lang or set_lang(resolve_lang())


def tr(vi, en):
    """Pick the message for the active language."""
    return en if get_lang() == "en" else vi


def pick(meta, key):
    """Localized field of a JSON object: `<key>_en` in English when present, else `<key>`."""
    if get_lang() == "en" and meta.get(f"{key}_en"):
        return meta[f"{key}_en"]
    return meta.get(key, "")
