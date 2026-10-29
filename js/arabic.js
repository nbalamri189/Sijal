// Arabic text helpers. normalize()/key() mirror tools/arabic.py so typed
// verses match the keys of the verses in the database.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const NON_LETTERS = /[^ء-ي\s]/g;
const LETTER = /[ء-ي]/;

export const ALPHABET = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص",
  "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي",
];

export const LETTER_NAMES = {
  "ا": "الهمزة / الألف", "ب": "الباء", "ت": "التاء", "ث": "الثاء", "ج": "الجيم",
  "ح": "الحاء", "خ": "الخاء", "د": "الدال", "ذ": "الذال", "ر": "الراء",
  "ز": "الزاي", "س": "السين", "ش": "الشين", "ص": "الصاد", "ض": "الضاد",
  "ط": "الطاء", "ظ": "الظاء", "ع": "العين", "غ": "الغين", "ف": "الفاء",
  "ق": "القاف", "ك": "الكاف", "ل": "اللام", "م": "الميم", "ن": "النون",
  "ه": "الهاء", "و": "الواو", "ي": "الياء",
};

export function stripDiacritics(text) {
  return text.replace(DIACRITICS, "");
}

export function normalize(text) {
  return stripDiacritics(text)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(NON_LETTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function key(text) {
  return normalize(text).replace(/ /g, "");
}

// Letters as heard at the edges of a verse: every hamza form counts as alef,
// alef maqsura as alef and ta marbuta as ha (tools/build_data.py end_letters).
export function edgeLetters(text) {
  return stripDiacritics(text)
    .replace(/[أإآٱءؤئ]/g, "ا")
    .replace(/ى/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^ء-ي]/g, "");
}

export function startLetter(text) {
  return edgeLetters(text)[0] || "";
}

// Levenshtein distance, giving up (returns max + 1) once it exceeds max.
export function boundedDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  const max = Math.ceil(longest * 0.25);
  return 1 - boundedDistance(a, b, max) / longest;
}

// Index (in UTF-16 units) of the n-th Arabic letter counted from the end.
export function letterIndexFromEnd(text, n) {
  let seen = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (LETTER.test(text[i])) {
      seen++;
      if (seen === n) return i;
    }
  }
  return -1;
}

export function firstLetterIndex(text) {
  for (let i = 0; i < text.length; i++) if (LETTER.test(text[i])) return i;
  return -1;
}

// Expands index i to include the diacritics that follow the letter there.
export function letterSpan(text, i) {
  let end = i + 1;
  while (end < text.length && /[ً-ٰٟ]/.test(text[end])) end++;
  return [i, end];
}

const NUM = new Intl.NumberFormat("ar-EG");
export function arNum(n) {
  return NUM.format(n);
}
