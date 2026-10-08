"""Supported stages and the labels used in source spreadsheets."""

from typing import Literal, get_args

ProgramLevel = Literal["本科", "硕士", "博士", "博士后", "硕转博"]
PROGRAM_LEVELS = list(get_args(ProgramLevel))
LEVEL_ALIASES = {
    "本": "本科", "本科": "本科", "本科生": "本科",
    "硕": "硕士", "硕士": "硕士", "硕士生": "硕士",
    "博": "博士", "博士": "博士", "博士生": "博士",
    "博后": "博士后", "博士后": "博士后",
    "硕转博": "硕转博",
}
