// Sharing: challenge links, the daily challenge, WhatsApp texts and the result image.
import { ALPHABET, arNum } from "./arabic.js?v=7";

export const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");

// ---------- challenge links ----------
// A challenge travels in the URL as ?c=<base64url JSON>, e.g.
// {m:"ai", s:94, n:"سارة", d:"hard", l:3} or {m:"daily", day:3, s:80, g:"11h0111"}.

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function challengeURL(challenge) {
  return `${SITE_URL}?c=${toBase64Url(JSON.stringify(challenge))}`;
}

// Parses and validates a challenge from the page URL. Everything in it is
// untrusted, so only known fields with sane values survive.
export function readChallenge() {
  const raw = new URLSearchParams(location.search).get("c");
  if (!raw) return null;
  try {
    const c = JSON.parse(fromBase64Url(raw));
    if (!["ai", "journey", "daily"].includes(c.m)) return null;
    const out = {
      m: c.m,
      s: Math.max(0, Math.min(99999, Math.floor(Number(c.s) || 0))),
      n: typeof c.n === "string" ? c.n.trim().slice(0, 20) : "",
    };
    if (c.m === "ai") out.d = ["easy", "medium", "hard"].includes(c.d) ? c.d : "medium";
    if (c.m !== "daily") out.l = [1, 3, 5].includes(c.l) ? c.l : 3;
    if (c.m === "daily") {
      out.day = Math.floor(Number(c.day) || 0);
      out.g = typeof c.g === "string" ? c.g.replace(/[^01h]/g, "").slice(0, DAILY_SIZE) : "";
    }
    if (c.m === "journey") out.k = Math.max(0, Math.min(ALPHABET.length, Math.floor(Number(c.k) || 0)));
    return out;
  } catch {
    return null;
  }
}

export function clearChallengeFromURL() {
  const url = new URL(location.href);
  url.searchParams.delete("c");
  history.replaceState(null, "", url);
}

// ---------- daily challenge ----------
export const DAILY_SIZE = 7;
const DAILY_EPOCH = Date.UTC(2026, 9, 29); // تحدّي اليوم رقم ١

export function dailyNumber(date = new Date()) {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - DAILY_EPOCH) / 86400000) + 1;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Five common letters and two rare ones, in an order fixed by the day number,
// so every player gets the same seven letters on the same day.
export function dailyLetters(day, letterCount) {
  const rand = mulberry32(day * 7919 + 17);
  const pick = (pool, n) => {
    const copy = [...pool];
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    return out;
  };
  const common = ALPHABET.filter((l) => letterCount(l) >= 3000);
  const rare = ALPHABET.filter((l) => letterCount(l) < 3000);
  const letters = [...pick(common, 5), ...pick(rare, 2)];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

// "1" solved, "h" solved with a hint, "0" missed.
export function gridEmoji(grid) {
  // A leading right-to-left mark keeps the squares in letter order inside WhatsApp.
  return "\u200F" + Array.from(grid, (c) => ({ 1: "🟩", h: "🟨", 0: "🟥" })[c] || "⬜").join("");
}

export function msUntilTomorrow() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

// ---------- WhatsApp & clipboard ----------
export function whatsappURL(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(text) {
  window.open(whatsappURL(text), "_blank", "noopener");
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function verseShareText(verse) {
  return `«${verse.sadr}\n${verse.ajuz}»\n— ${verse.poem.poet}\n\nمن مساجلة شعرية على «مساجلة». تقدر تجاريني؟\n${SITE_URL}`;
}

// ---------- result image ----------
const W = 1080;
const H = 1350;

function palette() {
  return {
    bg: "#f4ecdc", card: "#fffaf0", ink: "#2b2117", soft: "#6b5a45",
    accent: "#a5761f", strong: "#845b10", line: "#dccdb0",
    ok: "#2f7a3e", hint: "#c9a227", miss: "#b5503f",
  };
}

function fitFont(ctx, text, weight, family, maxSize, maxWidth) {
  let size = maxSize;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 18);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// card: {kicker, title, sub, grid?: [{letter, state}], verse?, footer}
export async function renderResultImage(card) {
  const verseFont = '"Amiri", serif';
  const uiFont = '"IBM Plex Sans Arabic", sans-serif';
  await Promise.all([
    document.fonts.load(`700 80px Amiri`),
    document.fonts.load(`400 40px Amiri`),
    document.fonts.load(`600 40px "IBM Plex Sans Arabic"`),
  ]).catch(() => {});

  const c = palette();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const glow = ctx.createRadialGradient(W / 2, 0, 50, W / 2, 0, 900);
  glow.addColorStop(0, "#ecd9ad");
  glow.addColorStop(1, c.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 3;
  roundRect(ctx, 40, 40, W - 80, H - 80, 36);
  ctx.stroke();

  ctx.fillStyle = c.strong;
  ctx.font = `700 150px ${verseFont}`;
  ctx.fillText("مساجلة", W / 2, 200);

  ctx.fillStyle = c.soft;
  fitFont(ctx, card.kicker, 500, uiFont, 42, W - 200);
  ctx.fillText(card.kicker, W / 2, 330);

  ctx.fillStyle = c.ink;
  fitFont(ctx, card.title, 700, verseFont, 120, W - 180);
  ctx.fillText(card.title, W / 2, 450);

  let y = 560;
  if (card.sub) {
    ctx.fillStyle = c.soft;
    fitFont(ctx, card.sub, 500, uiFont, 40, W - 200);
    ctx.fillText(card.sub, W / 2, y);
    y += 80;
  }

  if (card.grid?.length) {
    const perRow = Math.min(card.grid.length, 7);
    const size = Math.min(110, (W - 220) / perRow - 14);
    const gap = 14;
    const rows = Math.ceil(card.grid.length / perRow);
    for (let r = 0; r < rows; r++) {
      const items = card.grid.slice(r * perRow, (r + 1) * perRow);
      const rowW = items.length * size + (items.length - 1) * gap;
      items.forEach((cell, i) => {
        const x = W / 2 + rowW / 2 - (i + 1) * size - i * gap; // right to left
        ctx.fillStyle = { 1: c.ok, h: c.hint, 0: c.miss }[cell.state] || c.line;
        roundRect(ctx, x, y, size, size, 18);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${Math.round(size * 0.55)}px ${verseFont}`;
        ctx.fillText(cell.letter, x + size / 2, y + size / 2 + 4);
      });
      y += size + gap;
    }
    y += 40;
  }

  if (card.verse) {
    const boxY = Math.max(y, 760);
    const boxH = 330;
    ctx.fillStyle = c.card;
    roundRect(ctx, 100, boxY, W - 200, boxH, 28);
    ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c.ink;
    fitFont(ctx, card.verse.sadr, 400, verseFont, 54, W - 280);
    ctx.fillText(card.verse.sadr, W / 2, boxY + 90);
    fitFont(ctx, card.verse.ajuz, 400, verseFont, 54, W - 280);
    ctx.fillText(card.verse.ajuz, W / 2, boxY + 175);
    ctx.fillStyle = c.soft;
    fitFont(ctx, `— ${card.verse.poet}`, 500, uiFont, 34, W - 280);
    ctx.fillText(`— ${card.verse.poet}`, W / 2, boxY + 262);
  }

  ctx.fillStyle = c.accent;
  roundRect(ctx, W / 2 - 330, H - 210, 660, 96, 48);
  ctx.fill();
  ctx.fillStyle = "#fff8e8";
  fitFont(ctx, card.footer, 600, uiFont, 40, 600);
  ctx.fillText(card.footer, W / 2, H - 162);

  ctx.fillStyle = c.soft;
  ctx.font = `500 30px ${uiFont}`;
  ctx.direction = "ltr";
  ctx.fillText(SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""), W / 2, H - 75);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// Shares an image through the native share sheet (WhatsApp included on
// phones); falls back to downloading it.
export async function shareImage(blob, text) {
  const file = new File([blob], "sijal.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sijal.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}

export function arCount(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n % 100 >= 3 && n % 100 <= 10) return `${arNum(n)} ${few}`;
  return `${arNum(n)} ${many}`;
}
