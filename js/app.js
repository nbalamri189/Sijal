import {
  ALPHABET, LETTER_NAMES, arNum, firstLetterIndex, letterIndexFromEnd, letterSpan,
} from "./arabic.js";
import { letterCount, loadIndex, matchVerse, pickVerse } from "./db.js";
import {
  DAILY_SIZE, SITE_URL, arCount, challengeURL, clearChallengeFromURL, copyText, dailyLetters, dailyNumber,
  gridEmoji, msUntilTomorrow, openWhatsApp, readChallenge, renderResultImage, shareImage, verseShareText,
} from "./share.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const COLORS = ["#c08a2a", "#2a8a83", "#a4568a", "#5a7fc0"];
const AI_NAME = "الحاسوب";
const HINT_COST = 5;
const MODES = {
  duel: {
    title: "مساجلة بين لاعبين",
    desc: "يتناوب اللاعبون على جهاز واحد. كل بيت يبدأ برويّ البيت الذي قبله، ومن عجز خسر قلبًا وانتقل الحرف إلى من بعده. يفوز آخر من بقيت له قلوب.",
  },
  ai: {
    title: "تحدّي الحاسوب",
    desc: "تبدأ أنت ببيت، فيردّ الحاسوب ببيت يبدأ برويّ بيتك، ثم تجيبه من رويّ بيته… وهكذا حتى تنفد قلوبك. اجمع أكبر عدد من النقاط.",
  },
  daily: {
    title: "تحدّي اليوم",
    desc: "",
  },
  journey: {
    title: "رحلة الحروف",
    desc: "الحروف بالترتيب الهجائي من الألف إلى الياء: اذكر بيتًا يبدأ بكل حرف. التخطي أو انتهاء الوقت يكلّفك قلبًا وينقلك إلى الحرف التالي.",
  },
};
const DIFFICULTY_HINTS = {
  easy: "يختار الحاسوب أبياتًا مشهورة تنتهي بحروف شائعة.",
  medium: "يختار الحاسوب أبياتًا مشهورة بلا تحيّز في حروفها الأخيرة.",
  hard: "يتعمّد الحاسوب أن يُنهي أبياته بحروف نادرة كالظاء والثاء والضاد.",
};

// ---------- storage (best-effort; the game works without it) ----------
function store(name, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(`sijal.${name}`));
    localStorage.setItem(`sijal.${name}`, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

const settings = Object.assign(
  { mode: "duel", difficulty: "medium", time: 60, lives: 3, start: "random", players: ["اللاعب الأول", "اللاعب الثاني"] },
  store("settings") || {},
);

// ---------- helpers ----------
const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTouch = matchMedia("(pointer: coarse)").matches;

function safeURL(url) {
  if (!url) return "";
  if (url.startsWith("//")) url = "https:" + url;
  return /^https?:\/\//.test(url) ? url : "";
}

function highlight(text, i, cls) {
  if (i < 0) return escapeHTML(text);
  const [a, b] = letterSpan(text, i);
  return `${escapeHTML(text.slice(0, a))}<span class="${cls}">${escapeHTML(text.slice(a, b))}</span>${escapeHTML(text.slice(b))}`;
}

function verseHTML(verse, { who = "", color = "", pts = 0, shareIdx = -1 } = {}) {
  const sadr = highlight(verse.sadr, firstLetterIndex(verse.sadr), "start");
  const ajuz = highlight(verse.ajuz, letterIndexFromEnd(verse.ajuz, verse.depth), "rawi");
  const url = safeURL(verse.poem.url);
  const meta = [
    `<span>${escapeHTML(verse.poem.poet)}</span>`,
    verse.poem.title ? `<span>«${escapeHTML(verse.poem.title)}»</span>` : "",
    verse.poem.meter ? `<span>${escapeHTML(verse.poem.meter)}</span>` : "",
    url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">المصدر</a>` : "",
    pts ? `<span>+${arNum(pts)}</span>` : "",
    shareIdx >= 0 ? `<button class="verse-share" data-share="${shareIdx}" aria-label="شارك البيت عبر واتساب">شارك البيت</button>` : "",
  ].join("");
  return `<article class="verse" style="${color ? `--who:${color}` : ""}">
      ${who ? `<div class="verse-who">${escapeHTML(who)}</div>` : ""}
      <p class="verse-text"><span class="sadr">${sadr}</span><span class="ajuz">${ajuz}</span></p>
      <div class="verse-meta">${meta}</div>
    </article>`;
}

function letterPhrase(letter) {
  return `«${letter}» (${LETTER_NAMES[letter]})`;
}

function randomStartLetter() {
  const common = ALPHABET.filter((l) => letterCount(l) >= 1500);
  return common[Math.floor(Math.random() * common.length)];
}

function firstWords(text, n) {
  return text.split(/\s+/).slice(0, n).join(" ");
}

let toastTimer = null;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

const isSequence = (mode) => mode === "journey" || mode === "daily";
const pointsText = (n) => arCount(n, "نقطة واحدة", "نقطتين", "نقاط", "نقطة");

// ---------- screens ----------
function show(name) {
  if (name === "home") renderDailyCard();
  for (const s of $$(".screen")) s.classList.toggle("active", s.id === `screen-${name}`);
  document.body.classList.toggle("playing", name === "game");
  window.scrollTo(0, 0);
}

for (const el of $$("[data-go]")) {
  el.addEventListener("click", () => show(el.dataset.go));
}

$("#btn-rules").addEventListener("click", () => $("#rules").showModal());

// ---------- setup ----------
for (const card of $$(".mode-card")) {
  card.addEventListener("click", () => (card.dataset.mode === "daily" ? openDaily() : openSetup(card.dataset.mode)));
}

function openSetup(mode) {
  settings.mode = mode;
  $("#setup-title").textContent = MODES[mode].title;
  $("#setup-desc").textContent = MODES[mode].desc;
  $("#field-players").hidden = mode !== "duel";
  $("#field-difficulty").hidden = mode !== "ai";
  $("#field-start").hidden = mode === "journey";
  $("#btn-start").textContent = mode === "journey" ? "ابدأ الرحلة" : "ابدأ المساجلة";
  syncSegmented();
  renderPlayers();
  show("setup");
}

function syncSegmented() {
  for (const group of $$(".segmented")) {
    const value = String(settings[group.dataset.setting]);
    for (const b of group.querySelectorAll("button")) b.classList.toggle("on", b.dataset.value === value);
  }
  $("#difficulty-hint").textContent = DIFFICULTY_HINTS[settings.difficulty];
}

for (const group of $$(".segmented")) {
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const name = group.dataset.setting;
    settings[name] = ["time", "lives"].includes(name) ? Number(b.dataset.value) : b.dataset.value;
    syncSegmented();
  });
}

function renderPlayers() {
  const list = $("#player-list");
  list.innerHTML = "";
  settings.players.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<span class="player-dot" style="background:${COLORS[i]}"></span>
      <input maxlength="20" aria-label="اسم اللاعب ${arNum(i + 1)}">
      ${settings.players.length > 2 ? `<button class="icon-btn" aria-label="احذف اللاعب">✕</button>` : ""}`;
    const input = row.querySelector("input");
    input.value = name;
    input.addEventListener("input", () => (settings.players[i] = input.value));
    row.querySelector("button")?.addEventListener("click", () => {
      settings.players.splice(i, 1);
      renderPlayers();
    });
    list.append(row);
  });
  $("#btn-add-player").hidden = settings.players.length >= 4;
}

$("#btn-add-player").addEventListener("click", () => {
  const ordinals = ["الأول", "الثاني", "الثالث", "الرابع"];
  settings.players.push(`اللاعب ${ordinals[settings.players.length]}`);
  renderPlayers();
});

$("#btn-start").addEventListener("click", async () => {
  store("settings", settings);
  try {
    await indexReady;
  } catch {
    return;
  }
  newGame();
});

// ---------- game state ----------
let game = null;
const input = $("#verse-input");

const current = () => game.players[game.turn];
const humans = () => game.players.filter((p) => !p.ai);

function newGame(mode = settings.mode, challenge = null) {
  const names = mode === "duel"
    ? settings.players.map((n, i) => n.trim() || `اللاعب ${arNum(i + 1)}`)
    : ["أنت"];
  const lives = mode === "daily" ? Infinity : settings.lives;
  const players = names.map((name, i) => ({ name, color: COLORS[i], lives, score: 0, verses: 0, ai: false, out: false }));
  if (mode === "ai") players.push({ name: AI_NAME, color: COLORS[1], lives: Infinity, score: 0, verses: 0, ai: true, out: false });

  stopTimer();
  game = {
    mode,
    players,
    turn: 0,
    letter: null,
    chain: [],
    used: new Set(),
    fails: 0,
    letters: mode === "daily" ? dailyLetters(dailyNumber(), letterCount) : ALPHABET,
    day: dailyNumber(),
    journey: [],
    journeyIdx: 0,
    hints: 0,
    hinted: new Set(),
    time: mode === "daily" ? 0 : settings.time,
    challenge,
    token: 0,
    busy: false,
    deadline: 0,
    startedAt: Date.now(),
  };
  if (isSequence(mode)) game.letter = game.letters[0];
  else if (settings.start === "random") game.letter = randomStartLetter();

  $("#chain").innerHTML = "";
  $("#btn-hint").hidden = mode === "duel";
  $("#journey").hidden = !isSequence(mode);
  show("game");
  renderEmptyChain();
  startTurn();
}

function renderEmptyChain() {
  const l = game.letter;
  const lead = game.mode === "journey"
    ? "رحلتك تبدأ من الألف"
    : game.mode === "daily" ? `تحدّي اليوم #${arNum(game.day)}: سبعة أحرف، أولها ${letterPhrase(l)}`
    : l ? `أول بيت يبدأ بحرف ${letterPhrase(l)}` : "ابدأ بأي بيت شئت";
  $("#chain").innerHTML = `<li class="chain-empty chain-intro"><span class="big">${lead}</span>
    اكتب البيت كاملًا، صدره ثم عجزه. لا يُقبل إلا بيت موجود في الدواوين.</li>`;
}

function renderScoreboard() {
  $("#scoreboard").innerHTML = game.players.map((p, i) => {
    const hearts = p.ai ? "∞" : p.lives === Infinity ? "" : "♥".repeat(Math.max(0, p.lives)) + "♡".repeat(Math.max(0, settings.lives - p.lives));
    return `<div class="score-chip ${i === game.turn ? "current" : ""} ${p.out ? "out" : ""}" style="border-inline-start:4px solid ${p.color}">
      <span class="name">${escapeHTML(p.name)}</span>
      <span class="meta"><span class="hearts" aria-label="القلوب">${hearts}</span><span>${pointsText(p.score)}</span></span>
    </div>`;
  }).join("");

  if (isSequence(game.mode)) {
    $("#journey").innerHTML = game.letters.map((l, i) => {
      const state = game.journey[i] || (i === game.journeyIdx ? "now" : "");
      return `<span class="${state}">${l}</span>`;
    }).join("");
  }
}

function renderTurn() {
  const p = current();
  const badge = $("#letter-badge");
  const letterEl = $("#letter");
  if (game.letter) {
    letterEl.textContent = game.letter;
    letterEl.classList.remove("free");
    $(".letter-label").textContent = "ابدأ بحرف";
  } else {
    letterEl.textContent = "حرّ";
    letterEl.classList.add("free");
    $(".letter-label").textContent = "أي حرف";
  }
  badge.classList.remove("pop");
  void badge.offsetWidth;
  badge.classList.add("pop");

  const who = game.mode === "duel" ? `دور ${p.name}` : p.ai ? "دور الحاسوب" : "دورك";
  $("#turn-who").textContent = who;
  $("#turn-sub").innerHTML = p.ai
    ? `يتأمّل بيتًا… <span class="thinking"><i></i><i></i><i></i></span>`
    : game.letter ? `بيت يبدأ بحرف ${LETTER_NAMES[game.letter]}` : "ابدأ بأي بيت شئت";
  $(".dock").classList.toggle("waiting", p.ai);
  $("#btn-hint").disabled = !game.letter;
  renderScoreboard();
}

function startTurn() {
  game.token++;
  clearFeedback();
  input.value = "";
  renderTurn();
  if (current().ai) {
    stopTimer(true);
    game.deadline = 0;
    aiTurn(game.token);
    return;
  }
  startTimer();
  if (!isTouch) input.focus();
}

// ---------- timer ----------
let timerHandle = null;

function startTimer() {
  stopTimer();
  const secs = game.time;
  $("#timer").hidden = !secs;
  $("#clock").hidden = !secs;
  if (!secs) return;
  game.deadline = performance.now() + secs * 1000;
  const token = game.token;
  const tick = () => {
    const left = Math.max(0, game.deadline - performance.now());
    $("#timer-fill").style.transform = `scaleX(${left / (secs * 1000)})`;
    $("#clock").textContent = arNum(Math.ceil(left / 1000));
    const low = left < 10000;
    $("#timer").classList.toggle("low", low);
    $("#clock").classList.toggle("low", low);
    if (left <= 0 && token === game.token) {
      stopTimer();
      fail("timeout");
    }
  };
  tick();
  timerHandle = setInterval(tick, 200);
}

function stopTimer(hideClock = false) {
  clearInterval(timerHandle);
  timerHandle = null;
  if (hideClock) $("#clock").hidden = true;
}

function timeLeftFraction() {
  if (!game.time || !game.deadline) return 0;
  return Math.max(0, game.deadline - performance.now()) / (game.time * 1000);
}

// ---------- feedback ----------
function feedback(kind, html) {
  const box = $("#feedback");
  box.className = `feedback ${kind}`;
  box.innerHTML = html;
  box.hidden = false;
  if (kind === "error") {
    input.classList.remove("shake");
    void input.offsetWidth;
    input.classList.add("shake");
  }
}

function clearFeedback() {
  $("#feedback").hidden = true;
  $("#feedback").innerHTML = "";
}

function addNote(text) {
  const li = document.createElement("li");
  li.className = "note";
  li.textContent = text;
  appendChain(li);
}

function appendChain(li) {
  const chain = $("#chain");
  chain.querySelector(".chain-intro")?.remove();
  chain.append(li);
  chain.scrollTo({ top: chain.scrollHeight, behavior: "smooth" });
}

// ---------- moves ----------
$("#verse-form").addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

async function submit() {
  if (!game || game.busy || current().ai) return;
  const text = input.value.trim();
  if (!text) return;
  const token = game.token;
  game.busy = true;
  $("#btn-submit").disabled = true;
  let res = null;
  try {
    res = await matchVerse(text, { letter: game.letter, used: game.used });
  } catch {
    feedback("error", "تعذّر تحميل الأبيات. تحقّق من الاتصال وحاول مجددًا.");
  } finally {
    game.busy = false;
    $("#btn-submit").disabled = false;
  }
  if (!res || token !== game.token) return;

  const { status, verse } = res;
  if (status === "ok") {
    accept(verse);
  } else if (status === "suggest") {
    feedback("info", `لم أجد البيت بنصّه، فهل تقصد:
      <span class="suggest">${escapeHTML(verse.sadr)} ... ${escapeHTML(verse.ajuz)}</span>
      <span>${escapeHTML(verse.poem.poet)}</span>
      <span class="row"><button class="btn small primary" data-act="yes">نعم، هذا هو</button>
      <button class="btn small ghost" data-act="no">لا، سأصحّحه</button></span>`);
    $("#feedback").querySelector('[data-act="yes"]').addEventListener("click", () => {
      if (token === game.token) accept(verse);
    });
    $("#feedback").querySelector('[data-act="no"]').addEventListener("click", () => {
      clearFeedback();
      input.focus();
    });
  } else if (status === "used") {
    feedback("error", "هذا البيت قيل من قبل في هذه المساجلة، فهات غيره.");
  } else if (status === "sadr-only") {
    feedback("error", `هذا صدر بيت صحيح (الشاعر: ${escapeHTML(verse.poem.poet)})، فأكمله بعجزه.`);
  } else if (status === "wrong-letter") {
    feedback("error", `يجب أن يبدأ البيت بحرف ${letterPhrase(game.letter)}، وبيتك يبدأ بحرف «${res.got || "؟"}».`);
  } else if (status === "short") {
    feedback("error", "اكتب البيت كاملًا: صدره ثم عجزه.");
  } else {
    feedback("error", "لم أجد هذا البيت في الدواوين. تأكّد من نصّه، فلا يُقبل إلا بيت حقيقي.");
  }
}

function points(letter) {
  const max = Math.max(...ALPHABET.map(letterCount));
  const rarity = letter ? Math.round(Math.max(0, Math.log10(max / Math.max(1, letterCount(letter)))) * 6) : 0;
  const speed = Math.round(timeLeftFraction() * 5);
  return 10 + rarity + speed;
}

function accept(verse, player = current()) {
  stopTimer();
  const pts = points(game.letter);
  player.score += pts;
  player.verses++;
  game.used.add(verse.key);
  game.chain.push({ verse, player, pts });
  game.fails = 0;

  const li = document.createElement("li");
  li.innerHTML = verseHTML(verse, { who: player.name, color: player.color, pts });
  appendChain(li);

  if (isSequence(game.mode)) {
    game.journey[game.journeyIdx] = game.hinted.has(game.journeyIdx) ? "hinted" : "done";
    advanceJourney();
    return;
  }
  game.letter = verse.rawi;
  nextPlayer();
}

function fail(reason) {
  stopTimer();
  const p = current();
  const letter = game.letter;
  p.lives--;
  const solo = game.mode !== "duel";
  const why = reason === "timeout" ? "انتهى الوقت" : solo ? "أعجزك الحرف" : "أعجزه الحرف";
  const lost = solo ? "فخسرت قلبًا" : `فخسر ${p.name} قلبًا`;
  const missed = solo ? "لم تأتِ" : `لم يأتِ ${p.name}`;
  addNote(letter ? `${why}: ${missed} ببيت يبدأ بحرف ${LETTER_NAMES[letter]}، ${lost}.` : `${why}، ${lost}.`);

  if (isSequence(game.mode)) {
    game.journey[game.journeyIdx] = "skipped";
    if (p.lives <= 0) return endGame();
    advanceJourney();
    return;
  }

  if (p.lives <= 0) {
    p.out = true;
    addNote(`خرج ${p.name} من المساجلة.`);
  }
  const alive = humans().filter((h) => !h.out);
  if ((game.mode === "duel" && alive.length <= 1) || (game.mode === "ai" && alive.length === 0)) {
    return endGame();
  }
  game.fails++;
  if (game.mode === "duel" && game.fails >= alive.length) {
    game.letter = randomStartLetter();
    game.fails = 0;
    addNote(`عجز الجميع، فتغيّر الحرف إلى ${LETTER_NAMES[game.letter]}.`);
  }
  nextPlayer();
}

function nextPlayer() {
  const n = game.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (game.turn + step) % n;
    if (!game.players[idx].out) {
      game.turn = idx;
      break;
    }
  }
  startTurn();
}

function advanceJourney() {
  game.journeyIdx++;
  if (game.journeyIdx >= game.letters.length) return endGame();
  game.letter = game.letters[game.journeyIdx];
  startTurn();
}

async function aiTurn(token) {
  const letter = game.letter || randomStartLetter();
  game.letter = letter;
  renderTurn();
  const [verse] = await Promise.all([
    pickVerse(letter, { used: game.used, difficulty: settings.difficulty }).catch(() => null),
    sleep(1100 + Math.random() * 1300),
  ]);
  if (!game || token !== game.token) return;
  if (!verse) {
    const human = humans()[0];
    human.score += 20;
    addNote(`عجز الحاسوب عن حرف ${LETTER_NAMES[letter]}! لك ٢٠ نقطة.`);
    game.letter = randomStartLetter();
    nextPlayer();
    return;
  }
  accept(verse);
}

$("#btn-pass").addEventListener("click", () => {
  if (!game || current().ai || game.busy) return;
  fail("pass");
});

$("#btn-hint").addEventListener("click", async () => {
  if (!game || current().ai || !game.letter) return;
  const p = current();
  const token = game.token;
  const verse = await pickVerse(game.letter, { used: game.used, difficulty: "easy" }).catch(() => null);
  if (!verse || token !== game.token) return;
  p.score = Math.max(0, p.score - HINT_COST);
  game.hints++;
  if (isSequence(game.mode)) game.hinted.add(game.journeyIdx);
  renderScoreboard();
  feedback("info", `تلميح (−${arNum(HINT_COST)}): <span class="suggest">${escapeHTML(firstWords(verse.sadr, 3))}…</span>
    الشاعر: ${escapeHTML(verse.poem.poet)}`);
});

$("#btn-quit").addEventListener("click", () => {
  if (!confirm("أتريد إنهاء المساجلة؟")) return;
  stopTimer();
  game.token++;
  show("home");
});

// ---------- game over ----------
let shareState = null; // {text, url, card} for the current result

function stateCode(state) {
  return { done: "1", hinted: "h" }[state] || "0";
}

function bestVerse() {
  const mine = game.chain.filter((c) => !c.player.ai);
  const pool = mine.length ? mine : game.chain;
  return pool.reduce((best, c) => (!best || c.pts > best.pts ? c : best), null)?.verse || null;
}

function updateStreak(day) {
  const streak = store("daily.streak") || { last: 0, count: 0 };
  if (streak.last === day) return streak.count;
  const count = streak.last === day - 1 ? streak.count + 1 : 1;
  store("daily.streak", { last: day, count });
  return count;
}

function endGame() {
  stopTimer();
  game.token++;
  const kicker = $("#over-kicker");
  const title = $("#over-title");
  const sub = $("#over-sub");
  const stats = [];
  const human = humans()[0];
  const minutes = Math.max(1, Math.round((Date.now() - game.startedAt) / 60000));
  $("#daily-grid").hidden = true;

  if (game.mode === "duel") {
    const alive = humans().filter((p) => !p.out);
    const winner = alive.length === 1 ? alive[0] : [...humans()].sort((a, b) => b.score - a.score)[0];
    kicker.textContent = "انتهت المساجلة";
    title.textContent = `الفائز: ${winner.name}`;
    sub.textContent = `عدد أبيات المساجلة: ${arNum(game.chain.length)}، في نحو ${arNum(minutes)} دقيقة.`;
    for (const p of humans()) stats.push([arNum(p.score), `${p.name} · الأبيات: ${arNum(p.verses)}`]);
    const others = humans().filter((p) => p !== winner).map((p) => p.name).join(" و");
    prepareShare({
      title: "شارك نتيجة المساجلة",
      text: `🏆 فاز ${winner.name} على ${others} في مساجلة شعرية من ${arNum(game.chain.length)} بيتًا!\n\nمساجلة: كل بيت يبدأ بالحرف الذي انتهى به البيت قبله. جرّبوها مع أصحابكم 👇\n${SITE_URL}`,
      url: SITE_URL,
      card: {
        kicker: "مساجلة بين لاعبين", title: `الفائز: ${winner.name}`, footer: "ساجلني إن استطعت",
        sub: `${pointsText(winner.score)} · عدد الأبيات: ${arNum(game.chain.length)}`,
        verse: bestVerse() && pickVerseFields(bestVerse()),
      },
      askName: false,
    });
  } else if (game.mode === "daily") {
    const grid = game.letters.map((_, i) => stateCode(game.journey[i]));
    const solved = grid.filter((g) => g !== "0").length;
    const streak = updateStreak(game.day);
    const result = { grid: grid.join(""), score: human.score, solved, streak, verse: bestVerse() && pickVerseFields(bestVerse()) };
    store(`daily.${game.day}`, result);
    showDailyResult(game.day, result);
    finishOver();
    return;
  } else {
    const bestKey = game.mode === "ai" ? `best.ai.${settings.difficulty}` : "best.journey";
    const best = store(bestKey) || 0;
    const record = human.score > best;
    if (record) store(bestKey, human.score);
    let shareLine;
    let cardTitle;
    let cardSub;
    if (game.mode === "ai") {
      const level = { easy: "السهل", medium: "المتوسط", hard: "الصعب" }[settings.difficulty];
      kicker.textContent = "انتهى التحدّي";
      title.textContent = `${pointsText(human.score)}`;
      sub.textContent = record && best ? "رقم قياسي جديد!" : `عدد أبياتك في مساجلة الحاسوب: ${arNum(human.verses)}.`;
      shareLine = `ساجلتُ الحاسوب في المستوى ${level} وجمعت ${pointsText(human.score)} بـ${arCount(human.verses, "بيت واحد", "بيتين", "أبيات", "بيتًا")} 🔥`;
      cardTitle = `${pointsText(human.score)}`;
      cardSub = `تحدّي الحاسوب · المستوى ${level}`;
    } else {
      const done = game.journey.filter((s) => s !== "skipped").length;
      kicker.textContent = game.journeyIdx >= ALPHABET.length ? "أتممت الرحلة" : "انتهت الرحلة";
      title.textContent = `${arNum(done)} من ${arNum(ALPHABET.length)} حرفًا`;
      sub.textContent = record && best ? "رقم قياسي جديد!" : `جمعت ${pointsText(human.score)}.`;
      shareLine = `قطعت ${arNum(done)} من ${arNum(ALPHABET.length)} حرفًا في رحلة الحروف، وجمعت ${pointsText(human.score)} 🐪`;
      cardTitle = `${arNum(done)} / ${arNum(ALPHABET.length)}`;
      cardSub = `رحلة الحروف · ${pointsText(human.score)}`;
    }
    stats.push([arNum(human.score), "نقاطك"], [arNum(Math.max(best, human.score)), "أفضل نتيجة"], [arNum(human.verses), "أبياتك"]);
    if (game.hints) stats.push([arNum(game.hints), "تلميحات"]);
    const challenge = (name) => ({
      m: game.mode, s: human.score, n: name, t: settings.time, l: settings.lives,
      ...(game.mode === "ai" ? { d: settings.difficulty } : { k: human.verses }),
    });
    prepareShare({
      title: "تحدَّ أصدقاءك بنتيجتك",
      text: (url, name) => `${name ? `${name}: ` : ""}${shareLine}\nهل تتفوّق عليّ؟ 👇\n${url}`,
      url: (name) => challengeURL(challenge(name)),
      card: {
        kicker: "مساجلة شعرية", title: cardTitle, sub: cardSub, footer: "هل تتفوّق عليّ؟",
        // the journey shows its 28 letters instead of a verse
        ...(game.mode === "journey"
          ? { grid: game.letters.map((letter, i) => ({ letter, state: stateCode(game.journey[i]) })) }
          : { verse: bestVerse() && pickVerseFields(bestVerse()) }),
      },
      askName: true,
    });
  }

  $("#over-stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${escapeHTML(l)}</span></div>`).join("");
  showChallengeResult(human?.score);
  finishOver();
}

function finishOver() {
  $("#over-chain").innerHTML = game.chain.map(({ verse, player, pts }, i) =>
    `<li>${verseHTML(verse, { who: player.name, color: player.color, pts, shareIdx: i })}</li>`).join("");
  $(".over-chain").hidden = !game.chain.length;
  $("#btn-again").hidden = game.mode === "daily";
  show("over");
}

function pickVerseFields(v) {
  return { sadr: v.sadr, ajuz: v.ajuz, poet: v.poem.poet };
}

// Compares this result with the challenge the player accepted, if any.
function showChallengeResult(score) {
  const box = $("#challenge-result");
  const c = game?.challenge;
  box.hidden = !c || c.m !== game.mode;
  if (box.hidden) return;
  const rival = c.n || "صديقك";
  const diff = score - c.s;
  box.className = `challenge-result ${diff > 0 ? "won" : diff < 0 ? "lost" : ""}`;
  box.textContent = diff > 0
    ? `🎉 تفوّقت على ${rival} بفارق ${pointsText(diff)}!`
    : diff < 0 ? `تحتاج إلى ${pointsText(-diff)} أخرى لتتفوّق على ${rival} (${pointsText(c.s)}). حاول مجددًا!`
    : `تعادلت مع ${rival}: ${pointsText(c.s)} لكلٍّ منكما.`;
}

function showDailyResult(day, result) {
  const letters = dailyLetters(day, letterCount);
  $("#over-kicker").textContent = `تحدّي اليوم #${arNum(day)}`;
  $("#over-title").textContent = `${arNum(result.solved)} من ${arNum(DAILY_SIZE)}`;
  const hours = Math.floor(msUntilTomorrow() / 3600000);
  const mins = Math.floor((msUntilTomorrow() % 3600000) / 60000);
  const wait = [
    hours ? arCount(hours, "ساعة", "ساعتين", "ساعات", "ساعة") : "",
    mins ? arCount(mins, "دقيقة", "دقيقتين", "دقائق", "دقيقة") : "",
  ].filter(Boolean).join(" و") || "دقيقة";
  $("#over-sub").textContent = `التحدّي القادم بعد ${wait}.`;
  $("#over-stats").innerHTML = [
    [arNum(result.score), "نقاطك"],
    [`${arNum(result.streak)} 🔥`, "أيام متتالية"],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${escapeHTML(l)}</span></div>`).join("");
  const grid = $("#daily-grid");
  grid.hidden = false;
  grid.innerHTML = letters.map((l, i) => `<span class="cell s${result.grid[i] || "0"}">${l}</span>`).join("");

  const emoji = gridEmoji(result.grid);
  const days = (n) => arCount(n, "يوم واحد", "يومين", "أيام", "يومًا");
  const streakLine = result.streak > 1 ? ` · 🔥 ${days(result.streak)} متتالية` : "";
  const challenge = (name) => ({ m: "daily", day, s: result.score, n: name, g: result.grid });
  prepareShare({
    title: "شارك نتيجة اليوم",
    text: (url, name) => `مساجلة · تحدّي اليوم #${arNum(day)}\n${emoji}\n${arNum(result.solved)}/${arNum(DAILY_SIZE)} · ${pointsText(result.score)}${streakLine}\n${name ? `— ${name}\n` : ""}هل تغلبني؟ 👇\n${url}`,
    url: (name) => challengeURL(challenge(name)),
    card: {
      kicker: `تحدّي اليوم #${arNum(day)}`,
      title: `${arNum(result.solved)} / ${arNum(DAILY_SIZE)}`,
      sub: `${pointsText(result.score)}${result.streak > 1 ? ` · ${days(result.streak)} متتالية` : ""}`,
      grid: letters.map((letter, i) => ({ letter, state: result.grid[i] })),
      verse: result.verse,
      footer: "هل تغلبني اليوم؟",
    },
    askName: true,
  });
  showChallengeResult(result.score);
}

function prepareShare({ title, text, url, card, askName }) {
  shareState = { text, url, card, image: null };
  $("#share-title").textContent = title;
  $("#share-name-field").hidden = !askName;
  $("#share-name").value = store("name") || "";
  // Render the image up front so the share sheet opens straight from the click.
  renderResultImage(card).then((blob) => {
    if (shareState?.card === card) shareState.image = blob;
  });
}

function currentShareText() {
  const name = $("#share-name-field").hidden ? "" : $("#share-name").value.trim().slice(0, 20);
  if (name) store("name", name);
  const url = typeof shareState.url === "function" ? shareState.url(name) : shareState.url;
  return typeof shareState.text === "function" ? shareState.text(url, name) : shareState.text;
}

$("#share-wa").addEventListener("click", () => shareState && openWhatsApp(currentShareText()));

$("#share-copy").addEventListener("click", async () => {
  if (!shareState) return;
  toast((await copyText(currentShareText())) ? "نُسخت النتيجة، الصقها حيث شئت" : "تعذّر النسخ");
});

$("#share-image").addEventListener("click", async () => {
  if (!shareState) return;
  const text = currentShareText();
  const blob = shareState.image || (await renderResultImage(shareState.card));
  const how = await shareImage(blob, text);
  if (how === "downloaded") toast("حُفظت الصورة، أرسلها في واتساب مع الرابط");
});

$("#over-chain").addEventListener("click", (e) => {
  const b = e.target.closest("[data-share]");
  if (b && game) openWhatsApp(verseShareText(game.chain[Number(b.dataset.share)].verse));
});

$("#btn-again").addEventListener("click", () => newGame(game.mode, game.challenge));

// ---------- daily challenge ----------
async function openDaily(challenge = null) {
  try {
    await indexReady;
  } catch {
    return;
  }
  const day = dailyNumber();
  const played = store(`daily.${day}`);
  if (played) {
    game = { mode: "daily", chain: [], challenge, players: [] };
    showDailyResult(day, played);
    finishOver();
    return;
  }
  newGame("daily", challenge);
}

function renderDailyCard() {
  const day = dailyNumber();
  const played = store(`daily.${day}`);
  $("#daily-title").textContent = `تحدّي اليوم #${arNum(day)}`;
  if (played) {
    $("#daily-desc").textContent = `أنجزته اليوم: ${arNum(played.solved)} من ${arNum(DAILY_SIZE)} ${gridEmoji(played.grid)} — اضغط لمشاركة نتيجتك.`;
  }
}

// ---------- challenges & invites ----------
const incoming = readChallenge();
if (incoming) {
  const who = incoming.n || "صديقك";
  const level = { easy: "السهل", medium: "المتوسط", hard: "الصعب" }[incoming.d];
  const text = {
    ai: `🏆 تحدّاك ${who}: جمع ${pointsText(incoming.s)} في تحدّي الحاسوب (المستوى ${level}). هل تتفوّق عليه؟`,
    journey: `🏆 تحدّاك ${who}: جمع ${pointsText(incoming.s)} في رحلة الحروف. هل تتفوّق عليه؟`,
    daily: incoming.day === dailyNumber()
      ? `🏆 تحدّاك ${who} في تحدّي اليوم: ${gridEmoji(incoming.g)} بـ${pointsText(incoming.s)}. هل تغلبه؟`
      : `🏆 دعاك ${who} إلى تحدّي اليوم. سبعة أحرف، بلا وقت محدد. هل تقبل؟`,
  }[incoming.m];
  $("#challenge-text").textContent = text;
  $("#challenge-banner").hidden = false;
  $("#btn-accept").addEventListener("click", async () => {
    clearChallengeFromURL();
    $("#challenge-banner").hidden = true;
    const challenge = incoming.m === "daily" && incoming.day !== dailyNumber() ? null : incoming;
    if (incoming.m === "daily") return openDaily(challenge);
    settings.mode = incoming.m;
    settings.time = incoming.t;
    settings.lives = incoming.l;
    if (incoming.d) settings.difficulty = incoming.d;
    await indexReady;
    newGame(incoming.m, challenge);
  });
}

$("#btn-invite").addEventListener("click", () => {
  openWhatsApp(`تعال نتساجل بالشعر 🪶\nكل واحد يقول بيتًا يبدأ بالحرف الذي انتهى به بيت صاحبه، والأبيات كلها حقيقية من دواوين الشعراء.\n\nجرّب «مساجلة»: ${SITE_URL}`);
});

renderDailyCard();

// ---------- voice input ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const mic = $("#btn-mic");
  mic.hidden = false;
  let rec = null;
  mic.addEventListener("click", () => {
    if (rec) {
      rec.stop();
      return;
    }
    rec = new Recognition();
    rec.lang = "ar-SA";
    rec.interimResults = true;
    rec.continuous = true;
    const before = input.value ? input.value + " " : "";
    rec.onresult = (e) => {
      input.value = before + Array.from(e.results, (r) => r[0].transcript).join(" ");
    };
    rec.onend = () => {
      rec = null;
      mic.classList.remove("recording");
    };
    rec.onerror = rec.onend;
    mic.classList.add("recording");
    rec.start();
  });
}

// ---------- hosting badge ----------
// Netlify pins a badge to the bottom corner; keep the game buttons clear of it.
function watchBadge() {
  const check = () => {
    if (!document.getElementById("nl-badge-frame")) return false;
    document.body.classList.add("has-badge");
    return true;
  };
  if (check()) return;
  const observer = new MutationObserver(() => check() && observer.disconnect());
  observer.observe(document.body, { childList: true });
}
watchBadge();

// ---------- boot ----------
const indexReady = loadIndex();
indexReady
  .then((index) => {
    $("#db-stats").textContent = `في قاعدة الأبيات ${arNum(index.total)} بيتًا من شعر ${arNum(index.poets.length)} من الشعراء، من الجاهلية إلى العصر الحديث.`;
  })
  .catch(() => {
    $("#db-stats").textContent = "تعذّر تحميل قاعدة الأبيات. شغّل اللعبة عبر خادم ويب (انظر README).";
  });

