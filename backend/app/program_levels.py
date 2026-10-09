"""Supported stages and the labels used in source spreadsheets."""

import re
from typing import Literal, get_args

ProgramLevel = Literal["本科", "硕士", "博士", "博士后", "硕转博", "科研助理", "联培"]
PROGRAM_LEVELS = list(get_args(ProgramLevel))
LEVEL_ALIASES = {
    "本": "本科", "本科": "本科", "本科生": "本科",
    "硕": "硕士", "硕士": "硕士", "硕士生": "硕士",
    "博": "博士", "博士": "博士", "博士生": "博士",
    "博后": "博士后", "博士后": "博士后",
    "硕转博": "硕转博",
    "科研助理": "科研助理", "联培": "联培", "出国联培": "联培",
}


def level_from_note(note: str | None) -> str | None:
    """Recognize explicit source labels, including dated joint-training notes."""
    for part in re.split(r"[；;\n]", note or ""):
        match = re.match(r"^(科研助理|(?:出国)?联培)(?=$|[\s（(])", part.strip())
        if match:
            return LEVEL_ALIASES[match[1]]
    return None
