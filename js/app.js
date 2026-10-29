import {
  ALPHABET, LETTER_NAMES, arNum, firstLetterIndex, letterIndexFromEnd, letterSpan,
} from "./arabic.js";
import { letterCount, loadIndex, matchVerse, pickVerse } from "./db.js";

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

function verseHTML(verse, { who = "", color = "", pts = 0 } = {}) {
  const sadr = highlight(verse.sadr, firstLetterIndex(verse.sadr), "start");
  const ajuz = highlight(verse.ajuz, letterIndexFromEnd(verse.ajuz, verse.depth), "rawi");
  const url = safeURL(verse.poem.url);
  const meta = [
    `<span>${escapeHTML(verse.poem.poet)}</span>`,
    verse.poem.title ? `<span>«${escapeHTML(verse.poem.title)}»</span>` : "",
    verse.poem.meter ? `<span>${escapeHTML(verse.poem.meter)}</span>` : "",
    url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">المصدر</a>` : "",
    pts ? `<span>+${arNum(pts)}</span>` : "",
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

// ---------- screens ----------
function show(name) {
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
  card.addEventListener("click", () => openSetup(card.dataset.mode));
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

function newGame() {
  const mode = settings.mode;
  const names = mode === "duel"
    ? settings.players.map((n, i) => n.trim() || `اللاعب ${arNum(i + 1)}`)
    : ["أنت"];
  const players = names.map((name, i) => ({ name, color: COLORS[i], lives: settings.lives, score: 0, verses: 0, ai: false, out: false }));
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
    journey: [],
    journeyIdx: 0,
    hints: 0,
    token: 0,
    busy: false,
    deadline: 0,
    startedAt: Date.now(),
  };
  if (mode === "journey") game.letter = ALPHABET[0];
  else if (settings.start === "random") game.letter = randomStartLetter();

  $("#chain").innerHTML = "";
  $("#btn-hint").hidden = mode === "duel";
  $("#journey").hidden = mode !== "journey";
  show("game");
  renderEmptyChain();
  startTurn();
}

function renderEmptyChain() {
  const l = game.letter;
  const lead = game.mode === "journey"
    ? "رحلتك تبدأ من الألف"
    : l ? `أول بيت يبدأ بحرف ${letterPhrase(l)}` : "ابدأ بأي بيت شئت";
  $("#chain").innerHTML = `<li class="chain-empty chain-intro"><span class="big">${lead}</span>
    اكتب البيت كاملًا، صدره ثم عجزه. لا يُقبل إلا بيت موجود في الدواوين.</li>`;
}

function renderScoreboard() {
  $("#scoreboard").innerHTML = game.players.map((p, i) => {
    const hearts = p.ai ? "∞" : "♥".repeat(Math.max(0, p.lives)) + "♡".repeat(Math.max(0, settings.lives - p.lives));
    return `<div class="score-chip ${i === game.turn ? "current" : ""} ${p.out ? "out" : ""}" style="border-inline-start:4px solid ${p.color}">
      <span class="name">${escapeHTML(p.name)}</span>
      <span class="meta"><span class="hearts" aria-label="القلوب">${hearts}</span><span>${arNum(p.score)} نقطة</span></span>
    </div>`;
  }).join("");

  if (game.mode === "journey") {
    $("#journey").innerHTML = ALPHABET.map((l, i) => {
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
  const secs = settings.time;
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
  if (!settings.time || !game.deadline) return 0;
  return Math.max(0, game.deadline - performance.now()) / (settings.time * 1000);
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

  if (game.mode === "journey") {
    game.journey[game.journeyIdx] = "done";
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

  if (game.mode === "journey") {
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
  if (game.journeyIdx >= ALPHABET.length) return endGame();
  game.letter = ALPHABET[game.journeyIdx];
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
function endGame() {
  stopTimer();
  game.token++;
  const kicker = $("#over-kicker");
  const title = $("#over-title");
  const sub = $("#over-sub");
  const stats = [];
  const human = humans()[0];
  const minutes = Math.max(1, Math.round((Date.now() - game.startedAt) / 60000));

  if (game.mode === "duel") {
    const alive = humans().filter((p) => !p.out);
    const winner = alive.length === 1 ? alive[0] : [...humans()].sort((a, b) => b.score - a.score)[0];
    kicker.textContent = "انتهت المساجلة";
    title.textContent = `الفائز: ${winner.name}`;
    sub.textContent = `عدد أبيات المساجلة: ${arNum(game.chain.length)}، في نحو ${arNum(minutes)} دقيقة.`;
    for (const p of humans()) stats.push([arNum(p.score), `${p.name} · الأبيات: ${arNum(p.verses)}`]);
  } else {
    const bestKey = game.mode === "ai" ? `best.ai.${settings.difficulty}` : "best.journey";
    const best = store(bestKey) || 0;
    const record = human.score > best;
    if (record) store(bestKey, human.score);
    if (game.mode === "ai") {
      kicker.textContent = "انتهى التحدّي";
      title.textContent = `${arNum(human.score)} نقطة`;
      sub.textContent = record && best ? "رقم قياسي جديد!" : `عدد أبياتك في مساجلة الحاسوب: ${arNum(human.verses)}.`;
    } else {
      const done = game.journey.filter((s) => s === "done").length;
      kicker.textContent = game.journeyIdx >= ALPHABET.length ? "أتممت الرحلة" : "انتهت الرحلة";
      title.textContent = `${arNum(done)} من ${arNum(ALPHABET.length)} حرفًا`;
      sub.textContent = record && best ? "رقم قياسي جديد!" : `جمعت ${arNum(human.score)} نقطة.`;
    }
    stats.push([arNum(human.score), "نقاطك"], [arNum(Math.max(best, human.score)), "أفضل نتيجة"], [arNum(human.verses), "أبياتك"]);
    if (game.hints) stats.push([arNum(game.hints), "تلميحات"]);
  }

  $("#over-stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${escapeHTML(l)}</span></div>`).join("");
  $("#over-chain").innerHTML = game.chain.map(({ verse, player, pts }) =>
    `<li>${verseHTML(verse, { who: player.name, color: player.color, pts })}</li>`).join("");
  $(".over-chain").hidden = !game.chain.length;
  show("over");
}

$("#btn-again").addEventListener("click", newGame);

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

