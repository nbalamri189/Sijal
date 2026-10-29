"""Arabic text normalization shared by the data build scripts.

Mirrors the normalization in js/arabic.js so that verses typed by players
match the keys computed here.
"""
import re

DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
NON_LETTERS = re.compile(r"[^ء-ي\s]")


def strip_diacritics(text):
    return DIACRITICS.sub("", text)


def normalize(text):
    """Letters only, unified hamza/alef/ya/ta-marbuta forms, single spaces."""
    t = strip_diacritics(text)
    t = re.sub("[أإآٱ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    t = NON_LETTERS.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def key(text):
    """Space-free normalized form used for exact verse lookup."""
    return normalize(text).replace(" ", "")
