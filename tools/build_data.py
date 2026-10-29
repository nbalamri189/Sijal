"""Build the game's verse database from the Ashaar dataset.

Source: https://huggingface.co/datasets/arbml/ashaar (poems collected from
aldiwan.net, poetsgate.com, poetry.dctabudhabi.ae and others). Every verse in
the game comes from this dataset, with a link back to the poem's source page.

Usage:
    python3 tools/build_data.py path/to/train-00000.parquet path/to/train-00001.parquet

Writes data/index.json and data/shards/*.json. Verses are sharded by the first
two letters of their normalized text, so the browser only loads the shard that
can contain the verse a player typed.
"""
import collections
import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from arabic import key, normalize, strip_diacritics  # noqa: E402
from poets import POETS  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "data")

EXCLUDED_METERS = ("تفعيل", "نثر", "موشح", "عامي", "شعبي", "نبطي", "شعر حر", "الحر")
# Letters that can be وصل/خروج after the روي, so the روي may sit before them.
TRAILING = set("اويه")
MAX_SHARD = 2500


def end_letters(text):
    """Letters of a hemistich as heard at the end of a verse."""
    t = strip_diacritics(text)
    t = re.sub("[أإآٱءؤئ]", "ا", t)
    t = t.replace("ى", "ا").replace("ة", "ه")
    return re.sub(r"[^ء-ي]", "", t)


def start_letter(text):
    letters = end_letters(text)
    return letters[0] if letters else ""


def verse_fallback(letters):
    """روي of a lone verse: drop a final alif of إطلاق/تنوين."""
    if len(letters) > 2 and letters.endswith("وا"):  # واو الجماعة والألف الفارقة
        return letters[-3], 3
    if len(letters) > 1 and letters[-1] == "ا":
        return letters[-2], 2
    return letters[-1], 1


def poem_rawi(ends):
    """Return [(letter, depth)] per verse, using the rhyme shared by the poem.

    depth is the position of the روي counted in letters from the verse end.
    """
    if len(ends) < 3:
        return [verse_fallback(e) for e in ends]

    def mode_at(p):
        chars = [e[-p] if len(e) >= p else "" for e in ends]
        ch, n = collections.Counter(chars).most_common(1)[0]
        return ch, n / len(chars)

    ch, frac = mode_at(1)
    if frac < 0.75:
        return [verse_fallback(e) for e in ends]
    p = 1
    while p < 3 and ch in TRAILING:
        nxt, nfrac = mode_at(p + 1)
        if nfrac < 0.75:
            break
        p, ch = p + 1, nxt
    def assign(e):
        # A verse whose ending differs slightly still shares the poem's روي.
        for q in [p] + [q for q in (1, 2, 3) if q != p]:
            if len(e) >= q and e[-q] == ch:
                return ch, q
        return verse_fallback(e)

    return [assign(e) for e in ends]


def looks_classical(pairs, ends, era):
    """Heuristic for poems with no meter label: balanced hemistichs, one rhyme.

    Filters out free verse (شعر التفعيلة) whose lines were stored in pairs.
    """
    lens = [len(normalize(x)) for pair in pairs for x in pair]
    if min(lens) < 12 or max(lens) > 70 or max(lens) > 2.2 * min(lens):
        return False
    if len(ends) >= 3:
        top = collections.Counter(e[-1] for e in ends).most_common(1)[0][1]
        return top / len(ends) >= 0.75
    return era != "حديث"


def source_rank(url):
    if not isinstance(url, str):
        return 9
    for i, host in enumerate(("aldiwan.net", "poetry.dctabudhabi.ae", "poetsgate.com")):
        if host in url:
            return i
    return 5


def clean_line(line):
    t = str(line).replace("\u0640", "")
    t = re.sub(r"(^|\s)و\s+(?=\S)", r"\1و", t)  # "و لا" -> "ولا"
    return re.sub(r"\s+", " ", t).strip()


def main(paths):
    alias = {}
    for idx, (_, _, _, names) in enumerate(POETS):
        for n in names:
            alias[normalize(n)] = idx

    cols = ["poem title", "poem meter", "poem verses", "poem url", "poet name"]
    df = pd.concat([pd.read_parquet(p, columns=cols) for p in paths], ignore_index=True)
    df["poet_idx"] = df["poet name"].map(lambda n: alias.get(normalize(n)) if isinstance(n, str) else None)
    df = df[df["poet_idx"].notna()].copy()
    meter = df["poem meter"].fillna("")
    df = df[~meter.map(lambda m: any(x in m for x in EXCLUDED_METERS))]
    df["rank"] = df["poem url"].map(source_rank)
    df = df.sort_values(["rank"], kind="stable")

    seen = set()
    shards = collections.defaultdict(lambda: {"poems": [], "verses": [], "poem_ids": {}})
    verses = []
    poem_counter = 0
    stats = collections.Counter()

    for row in df.itertuples(index=False):
        meter = row[1] if isinstance(row[1], str) else ""
        lines = [clean_line(x) for x in row[2]]
        if len(lines) < 2 or len(lines) % 2:
            stats["odd"] += 1
            continue
        pairs = [(lines[i], lines[i + 1]) for i in range(0, len(lines), 2)]
        ok = all(6 <= len(normalize(s)) <= 90 and 6 <= len(normalize(a)) <= 90 for s, a in pairs)
        if not ok:
            stats["bad_len"] += 1
            continue
        ends = [end_letters(a) for _, a in pairs]
        if not meter and not looks_classical(pairs, ends, POETS[int(row.poet_idx)][1]):
            stats["not_classical"] += 1
            continue
        rawis = poem_rawi(ends)
        poem_counter += 1
        poet_idx = int(row.poet_idx)
        meter_name = re.sub(r"^بحر\s+", "", meter).strip()
        for i, ((s, a), (r, d)) in enumerate(zip(pairs, rawis)):
            k = key(s + a)
            if k in seen or not r:
                stats["dup"] += 1
                continue
            seen.add(k)
            if len(key(s)) < 3:
                continue
            poem = (poem_counter, poet_idx, clean_line(row[0] if isinstance(row[0], str) else ""), row[3] if isinstance(row[3], str) else "", meter_name)
            verses.append((key(s), [s, a, r, d, 1 if i == 0 else 0], poem))
            stats["verses"] += 1

    # Shard by the first two letters, using longer prefixes for crowded ones.
    counts = collections.Counter(k[:n] for k, _, _ in verses for n in range(2, 6))
    for k, verse, poem in verses:
        n = 2
        while n < 5 and len(k) > n and counts[k[:n]] > MAX_SHARD:
            n += 1
        prefix = k[:n]
        shard = shards["-".join(f"{ord(c):04x}" for c in prefix)]
        pid = shard["poem_ids"].get(poem[0])
        if pid is None:
            pid = len(shard["poems"])
            shard["poem_ids"][poem[0]] = pid
            shard["poems"].append(list(poem[1:]))
        shard["verses"].append(verse[:2] + [pid] + verse[2:])

    os.makedirs(os.path.join(OUT, "shards"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "shards")):
        os.remove(os.path.join(OUT, "shards", f))

    letters = collections.defaultdict(lambda: {"count": 0, "shards": []})
    for name, shard in sorted(shards.items()):
        with open(os.path.join(OUT, "shards", name + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"poems": shard["poems"], "verses": shard["verses"]}, fh, ensure_ascii=False, separators=(",", ":"))
        lead = start_letter(shard["verses"][0][0])
        famous = sum(1 for v in shard["verses"] if v[5] and POETS[shard["poems"][v[2]][0]][2] == 1)
        letters[lead]["count"] += len(shard["verses"])
        letters[lead]["shards"].append([name, len(shard["verses"]), famous])

    rawi_counts = collections.Counter(v[3] for s in shards.values() for v in s["verses"])
    index = {
        "source": "https://huggingface.co/datasets/arbml/ashaar",
        "total": stats["verses"],
        "poets": [[n, era, tier] for n, era, tier, _ in POETS],
        "letters": letters,
        "rawi": dict(rawi_counts),
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
    print(dict(stats), "shards:", len(shards))


if __name__ == "__main__":
    main(sys.argv[1:])
