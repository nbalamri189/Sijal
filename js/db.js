// Verse database: lazy-loaded shards keyed by the first letters of a verse.
import { key, startLetter, similarity } from "./arabic.js";

let index = null;
const shardNames = new Set();
const shardCache = new Map();

export async function loadIndex() {
  if (index) return index;
  const res = await fetch("data/index.json");
  if (!res.ok) throw new Error("تعذّر تحميل قاعدة الأبيات");
  index = await res.json();
  for (const info of Object.values(index.letters)) {
    for (const [name] of info.shards) shardNames.add(name);
  }
  return index;
}

export function getIndex() {
  return index;
}

export function letterCount(letter) {
  return index?.letters[letter]?.count || 0;
}

function shardName(k, n) {
  return Array.from(k.slice(0, n), (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("-");
}

function shardFor(k) {
  for (let n = Math.min(5, k.length); n >= 2; n--) {
    const name = shardName(k, n);
    if (shardNames.has(name)) return name;
  }
  return null;
}

function loadShard(name) {
  if (!shardCache.has(name)) {
    const promise = fetch(`data/shards/${name}.json`)
      .then((res) => {
        if (!res.ok) throw new Error("تعذّر تحميل الأبيات");
        return res.json();
      })
      .then((data) => {
        const poems = data.poems.map(([poet, title, url, meter]) => {
          const [poetName, era, tier] = index.poets[poet];
          return { poet: poetName, era, tier, title, url, meter };
        });
        return data.verses.map(([sadr, ajuz, p, rawi, depth, matla]) => ({
          sadr,
          ajuz,
          poem: poems[p],
          rawi,
          depth,
          matla: matla === 1,
          key: key(sadr + ajuz),
          sadrKey: key(sadr),
          start: startLetter(sadr),
        }));
      });
    promise.catch(() => shardCache.delete(name));
    shardCache.set(name, promise);
  }
  return shardCache.get(name);
}

// Looks up a verse typed by a player.
// Returns {status, verse?, got?} where status is one of:
// ok | suggest | used | sadr-only | wrong-letter | short | not-found
export async function matchVerse(input, { letter = null, used = new Set() } = {}) {
  const k = key(input);
  if (k.length < 10) return { status: "short" };
  const got = startLetter(input);
  if (letter && got !== letter) return { status: "wrong-letter", got };

  const name = shardFor(k);
  if (!name) return { status: "not-found" };
  const verses = await loadShard(name);

  const found = (verse, status) => (used.has(verse.key) ? { status: "used", verse } : { status, verse });

  const exact = verses.find((v) => v.key === k);
  if (exact) return found(exact, "ok");

  let best = null;
  let bestScore = 0;
  let bestSadr = null;
  let bestSadrScore = 0;
  for (const v of verses) {
    if (Math.abs(v.key.length - k.length) <= k.length * 0.25) {
      const s = similarity(k, v.key);
      if (s > bestScore) [best, bestScore] = [v, s];
    }
    if (Math.abs(v.sadrKey.length - k.length) <= k.length * 0.15) {
      const s = similarity(k, v.sadrKey);
      if (s > bestSadrScore) [bestSadr, bestSadrScore] = [v, s];
    }
  }
  if (best && bestScore >= 0.9) return found(best, "ok");
  if (bestSadr && bestSadrScore >= 0.88 && bestSadrScore > bestScore) return { status: "sadr-only", verse: bestSadr };
  if (best && bestScore >= 0.78) return found(best, "suggest");
  return { status: "not-found" };
}

function weightedPick(items, weight) {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Chooses a real verse starting with `letter`, for the computer or a hint.
// difficulty shapes which rhyme letter the verse ends with:
// easy favours common next letters, hard favours rare ones.
export async function pickVerse(letter, { used = new Set(), difficulty = "medium", famous = true } = {}) {
  const info = index.letters[letter];
  if (!info) return null;
  const shards = [...info.shards];
  for (let attempt = 0; attempt < 4 && shards.length; attempt++) {
    const choice = weightedPick(shards, ([, count, fam]) => (famous ? fam * 4 + count * 0.05 : count));
    shards.splice(shards.indexOf(choice), 1);
    const verses = (await loadShard(choice[0])).filter((v) => !used.has(v.key) && letterCount(v.rawi) > 0);
    if (!verses.length) continue;

    let pool;
    if (difficulty === "hard") {
      pool = verses.filter((v) => v.poem.tier === 1);
    } else {
      pool = verses.filter((v) => v.matla && v.poem.tier === 1);
      if (!pool.length) pool = verses.filter((v) => v.poem.tier === 1);
    }
    if (!famous || !pool.length) pool = verses;

    const weight = {
      easy: (v) => letterCount(v.rawi),
      medium: () => 1,
      hard: (v) => 1 / letterCount(v.rawi) ** 1.2,
    }[difficulty];
    return weightedPick(pool, weight);
  }
  return null;
}
