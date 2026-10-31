"""Build the game's verse database from the Ashaar dataset.

Source: https://huggingface.co/datasets/arbml/ashaar (poems collected from
aldiwan.net, poetsgate.com, poetry.dctabudhabi.ae and others). Every verse in
the game comes from this dataset, with a link back to the poem's source page.

Usage:
    python3 tools/build_data.py path/to/train-00000.parquet path/to/train-00001.parquet

Poets listed in tools/poets.py come from every source. All other poets on
aldiwan.net are added too, as tier 3, with the era the dataset gives them.
Poems typed or pasted into poems/*.txt are added as well (see poems/README.md);
they win over the dataset's copy of the same verse.

Writes data/index.json and data/shards/*.json, and lists every poem and poet
in the database in catalog/poems.tsv and catalog/poets.tsv. Verses are sharded by the first
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

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data")
MANUAL = os.path.join(ROOT, "poems")
CATALOG = os.path.join(ROOT, "catalog")
HEADERS = {"الشاعر": "poet name", "القصيدة": "poem title", "البحر": "poem meter", "المصدر": "poem url", "العصر": "poet era"}

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
    p = 1
    if frac < 0.75:
        # A وصل letter written in some verses only: «غالي» beside «الشمال».
        bare = [e[:-1] if len(e) > 1 and e[-1] in TRAILING else e for e in ends]
        ch, n = collections.Counter(e[-1:] for e in bare).most_common(1)[0]
        if n / len(ends) < 0.75 or ch in TRAILING:
            return [verse_fallback(e) for e in ends]
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


def well_formed(pairs):
    return all(6 <= len(normalize(s)) <= 90 and 6 <= len(normalize(a)) <= 90 for s, a in pairs)


def repair(lines):
    """Pairs for a poem the dataset stored with a stray line (".", "*", a
    verse number) that shifts every sadr and ajuz after it.

    Accepted only when the repaired poem rhymes: a pairing that is still off
    puts sadrs in the ajuz column, and those rarely share one روي.
    """
    lines = [re.sub(r"^[\d٠-٩]+\s*[-.)]\s*", "", x) for x in lines if normalize(x)]
    if len(lines) < 6 or len(lines) % 2:
        return None
    pairs = [(lines[i], lines[i + 1]) for i in range(0, len(lines), 2)]
    if not well_formed(pairs):
        return None
    ends = [end_letters(a) for _, a in pairs]
    top = collections.Counter(e[-1] for e in ends).most_common(1)[0][1]
    return pairs if top / len(ends) >= 0.75 else None


def read_manual_poems(folder):
    """Poems in poems/*.txt: header lines, then one hemistich per line.

    A line may also hold a whole verse with its halves split by * or a tab.
    Poems in one file are separated by a line of ---, and a poem without
    الشاعر or العصر takes them from the poem before it.
    """
    rows = []
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not name.endswith(".txt"):
            continue
        with open(os.path.join(folder, name), encoding="utf-8") as fh:
            blocks = re.split(r"(?m)^\s*-{3,}\s*$", fh.read())
        inherited = {}
        for n, block in enumerate(blocks, 1):
            poem, lines = dict(inherited), []
            for line in block.splitlines():
                line = line.strip()
                m = re.match(r"^(%s)\s*:\s*(.*)$" % "|".join(HEADERS), line)
                if m and not lines:
                    poem[HEADERS[m.group(1)]] = m.group(2).strip()
                elif line:
                    lines.extend(x.strip() for x in re.split(r"\s*[*\t]\s*", line) if x.strip())
            if not lines:
                continue
            where = f"poems/{name}, القصيدة {n}"
            if not poem.get("poet name"):
                sys.exit(f"{where}: لا يوجد سطر «الشاعر:»")
            if len(lines) % 2:
                sys.exit(f"{where}: عدد الأشطر فردي ({len(lines)})، فلكل صدر عجز")
            inherited = {k: poem[k] for k in ("poet name", "poet era") if k in poem}
            rows.append({**{c: "" for c in HEADERS.values()}, **poem, "poem verses": lines})
    return pd.DataFrame(rows, columns=list(HEADERS.values()) + ["poem verses"])


def write_catalog(poems, poets):
    """Lists every poem and poet in the database, to check what is already in."""
    os.makedirs(CATALOG, exist_ok=True)
    clean = lambda t: re.sub(r"\s+", " ", str(t)).strip()
    per_poet = collections.Counter()
    verses = collections.Counter()
    with open(os.path.join(CATALOG, "poems.tsv"), "w", encoding="utf-8") as fh:
        fh.write("الشاعر\tالقصيدة\tالأبيات\tالمصدر\n")
        for poet_idx, title, url, count in sorted(poems, key=lambda p: (poets[p[0]][0], p[1])):
            per_poet[poet_idx] += 1
            verses[poet_idx] += count
            fh.write(f"{poets[poet_idx][0]}\t{clean(title)}\t{count}\t{clean(url)}\n")
    with open(os.path.join(CATALOG, "poets.tsv"), "w", encoding="utf-8") as fh:
        fh.write("الشاعر\tالعصر\tالدرجة\tالقصائد\tالأبيات\n")
        for i in sorted(range(len(poets)), key=lambda i: -verses[i]):
            name, era, tier = poets[i]
            fh.write(f"{name}\t{era}\t{tier}\t{per_poet[i]}\t{verses[i]}\n")


def main(paths):
    alias = {}
    for idx, (_, _, _, names) in enumerate(POETS):
        for n in names:
            alias[normalize(n)] = idx

    cols = ["poem title", "poem meter", "poem verses", "poem url", "poet name", "poet era"]
    df = pd.concat([pd.read_parquet(p, columns=cols) for p in paths], ignore_index=True)
    meter = df["poem meter"].fillna("")
    df = df[~meter.map(lambda m: any(x in m for x in EXCLUDED_METERS))].copy()
    df["rank"] = df["poem url"].map(source_rank)
    df["manual"] = False
    manual = read_manual_poems(MANUAL)
    manual["rank"] = -1
    manual["manual"] = True
    df = pd.concat([manual[df.columns], df], ignore_index=True)
    df["poet_idx"] = df["poet name"].map(lambda n: alias.get(normalize(n)) if isinstance(n, str) else None)
    df["extra"] = df["poet_idx"].isna()
    df = df[df["poet_idx"].notna() | ((df["rank"] <= 0) & df["poet name"].map(lambda n: isinstance(n, str) and len(normalize(n)) > 1))]
    # Listed poets first, so their verses win over duplicates credited to others.
    df = df.sort_values(["extra", "rank"], kind="stable")

    poets = [[n, era, tier] for n, era, tier, _ in POETS]
    for row in df[df["extra"]].itertuples(index=False):
        name = normalize(row[4])
        if name not in alias:
            era = re.sub(r"^(العصر\s+)?ال", "", row[5]).strip() if isinstance(row[5], str) else ""
            alias[name] = len(poets)
            poets.append([re.sub(r"\s+", " ", row[4]).strip(), era, 3])
    df["poet_idx"] = df["poet name"].map(lambda n: alias[normalize(n)])

    seen = set()
    shards = collections.defaultdict(lambda: {"poems": [], "verses": [], "poem_ids": {}})
    verses = []
    poem_counter = 0
    stats = collections.Counter()
    catalog = {}

    for row in df.itertuples(index=False):
        meter = row[1] if isinstance(row[1], str) else ""
        lines = [clean_line(x) for x in row[2]]
        pairs = [(lines[i], lines[i + 1]) for i in range(0, len(lines) - 1, 2)]
        if len(lines) % 2 or not well_formed(pairs):
            fixed = None if row.manual else repair(lines)
            if fixed:
                pairs, lines = fixed, [x for pair in fixed for x in pair]
                stats["repaired"] += 1
        if len(lines) < 2 or len(lines) % 2:
            stats["odd"] += 1
            continue
        if not well_formed(pairs):
            if row.manual:
                print(f"تنبيه: «{row[0]}» لـ{row[4]} فيها شطر أقصر من ٦ أحرف أو أطول من ٩٠، فلم تُضَف")
            stats["bad_len"] += 1
            continue
        ends = [end_letters(a) for _, a in pairs]
        if not meter and not row.manual and not looks_classical(pairs, ends, poets[int(row.poet_idx)][1]):
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
            stats["manual"] += row.manual
            catalog.setdefault(poem_counter, [poet_idx, poem[2], poem[3], 0])[3] += 1

    # Drop added poets whose poems were all filtered out.
    kept = set(range(len(POETS))) | {poem[1] for _, _, poem in verses}
    remap = {old: new for new, old in enumerate(sorted(kept))}
    poets = [p for i, p in enumerate(poets) if i in kept]
    verses = [(k, v, (poem[0], remap[poem[1]]) + poem[2:]) for k, v, poem in verses]
    write_catalog([[remap[p], t, u, n] for p, t, u, n in catalog.values()], poets)

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
        famous = sum(1 for v in shard["verses"] if v[5] and poets[shard["poems"][v[2]][0]][2] == 1)
        letters[lead]["count"] += len(shard["verses"])
        letters[lead]["shards"].append([name, len(shard["verses"]), famous])

    rawi_counts = collections.Counter(v[3] for s in shards.values() for v in s["verses"])
    index = {
        "source": "https://huggingface.co/datasets/arbml/ashaar",
        "total": stats["verses"],
        "poets": poets,
        "letters": letters,
        "rawi": dict(rawi_counts),
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
    print(dict(stats), "shards:", len(shards))


if __name__ == "__main__":
    main(sys.argv[1:])
