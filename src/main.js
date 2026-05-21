/** @typedef {{ id: number, country: string, continent: string, imageUrl: string, mapsUrl?: string, lat?: number | null, lng?: number | null, mapsViewUrl?: string | null }} Bollard */
/** @typedef {{ entries: Bollard[], countries: string[], byContinent: Record<string, string[]> }} Dataset */

const SETTINGS_KEY = "bollard-quiz-settings";

/** @type {Dataset | null} */
let dataset = null;
/** @type {Bollard[]} */
let questionPool = [];

let score = 0;
let streak = 0;
let round = 0;
let maxRounds = 10;
let choiceCount = 4;
/** @type {"world" | "continent" | "continent-strict"} */
let distractorMode = "continent";
/** @type {"all" | "unique"} */
let poolMode = "all";
let showContinentHint = false;
let answered = false;

/** @type {Bollard | null} */
let current = null;
/** @type {string[]} */
let currentChoices = [];

const $ = (id) => document.getElementById(id);

const els = {
  startScreen: $("start-screen"),
  gamePanel: $("game-panel"),
  endScreen: $("end-screen"),
  image: $("bollard-image"),
  choices: $("choices"),
  feedback: $("feedback"),
  score: $("score"),
  streak: $("streak"),
  round: $("round"),
  totalRounds: $("total-rounds"),
  nextBtn: $("next-btn"),
  skipBtn: $("skip-btn"),
  startBtn: $("start-btn"),
  playAgainBtn: $("play-again-btn"),
  loadingMsg: $("loading-msg"),
  continentHint: $("continent-hint"),
  finalScore: $("final-score"),
  finalTotal: $("final-total"),
  endDetail: $("end-detail"),
  roundsSelect: $("rounds-select"),
  choicesSelect: $("choices-select"),
  distractorSelect: $("distractor-select"),
  poolSelect: $("pool-select"),
  continentHintCheck: $("continent-hint-check"),
  settingsPreview: $("settings-preview"),
  mapsLink: $("maps-link"),
  mapsCoords: $("maps-coords"),
};

/** @param {Bollard} entry */
function googleMapsUrl(entry) {
  if (entry.lat != null && entry.lng != null) {
    return `https://www.google.com/maps/@${entry.lat},${entry.lng},3a`;
  }
  if (entry.mapsViewUrl) return entry.mapsViewUrl;
  if (entry.mapsUrl) return entry.mapsUrl;
  return null;
}

function updateMapsLink(entry, visible) {
  const url = googleMapsUrl(entry);
  if (!url || !visible) {
    els.mapsLink.hidden = true;
    return;
  }
  els.mapsLink.href = url;
  if (entry.lat != null && entry.lng != null) {
    els.mapsCoords.textContent = `${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`;
    els.mapsLink.title = `Street View at ${entry.lat}, ${entry.lng}`;
  } else {
    els.mapsCoords.textContent = "";
    els.mapsLink.title = "Open GeoHints location in Google Maps";
  }
  els.mapsLink.hidden = false;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function readSettingsFromForm() {
  choiceCount = Math.max(2, Math.min(8, Number(els.choicesSelect.value) || 4));
  distractorMode = /** @type {typeof distractorMode} */ (els.distractorSelect.value);
  poolMode = /** @type {typeof poolMode} */ (els.poolSelect.value);
  showContinentHint = els.continentHintCheck.checked;
  maxRounds = Number(els.roundsSelect.value);
}

function distractorLabel() {
  if (distractorMode === "world") return "any country";
  if (distractorMode === "continent-strict") return "same continent only";
  return "same continent first, then worldwide";
}

function updateSettingsPreview() {
  readSettingsFromForm();
  if (dataset) buildQuestionPool();
  const roundsLabel = maxRounds ? `${maxRounds} rounds` : "endless";
  const poolLabel = poolMode === "unique" ? "one bollard per country" : "all bollards";
  let hint = `${roundsLabel} · ${choiceCount} choices · wrong answers from ${distractorLabel()} · ${poolLabel}`;
  if (distractorMode === "continent" && choiceCount > 7) {
    hint +=
      " · Note: small continents (e.g. North America has 7 countries) top up extra wrong answers from other continents.";
  }
  if (distractorMode === "continent-strict" && dataset) {
    const eligible = eligibleQuestionPool();
    if (!eligible.length) {
      hint += " · Same-continent-only cannot fill this many choices — lower choices or switch distractor mode.";
    } else if (eligible.length < questionPool.length) {
      hint += ` · Strict mode: only ${eligible.length} bollards can use ${choiceCount} choices.`;
    }
  }
  els.settingsPreview.textContent = hint;
}

function saveSettings() {
  readSettingsFromForm();
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      maxRounds,
      choiceCount,
      distractorMode,
      poolMode,
      showContinentHint,
    }),
  );
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.maxRounds != null) els.roundsSelect.value = String(s.maxRounds);
    if (s.choiceCount != null) els.choicesSelect.value = String(s.choiceCount);
    if (s.distractorMode) {
      els.distractorSelect.value = s.distractorMode;
    } else if (s.difficulty === "easy") {
      els.distractorSelect.value = "world";
    } else if (s.difficulty === "hard") {
      els.distractorSelect.value = "continent-strict";
    }
    if (s.poolMode) els.poolSelect.value = s.poolMode;
    if (s.showContinentHint) els.continentHintCheck.checked = true;
  } catch {
    /* ignore corrupt storage */
  }
  updateSettingsPreview();
}

/** @param {Bollard} entry */
function continentPool(entry) {
  return (dataset?.byContinent[entry.continent] ?? []).filter((c) => c !== entry.country);
}

function sampleCountries(pool, count) {
  return shuffle(pool).slice(0, Math.min(count, pool.length));
}

function eligibleQuestionPool() {
  if (distractorMode !== "continent-strict") return questionPool;
  const needed = choiceCount - 1;
  return questionPool.filter((e) => continentPool(e).length >= needed);
}

function buildQuestionPool() {
  if (!dataset) {
    questionPool = [];
    return;
  }
  if (poolMode === "unique") {
    const byCountry = new Map();
    for (const e of dataset.entries) {
      if (!byCountry.has(e.country)) byCountry.set(e.country, e);
    }
    questionPool = [...byCountry.values()];
  } else {
    questionPool = dataset.entries;
  }
}

/** @param {Bollard} entry */
function pickDistractors(entry) {
  if (!dataset) return [];

  const needed = choiceCount - 1;
  const allCountries = dataset.countries.filter((c) => c !== entry.country);
  const sameContinent = continentPool(entry);

  if (distractorMode === "world") {
    return sampleCountries(allCountries, needed);
  }

  const distractors = sampleCountries(sameContinent, needed);

  if (distractorMode === "continent-strict") {
    return distractors;
  }

  if (distractors.length < needed) {
    const worldwide = allCountries.filter((c) => !distractors.includes(c));
    distractors.push(...sampleCountries(worldwide, needed - distractors.length));
  }

  return distractors;
}

function pickQuestion() {
  const pool =
    distractorMode === "continent-strict" ? eligibleQuestionPool() : questionPool;
  if (!pool.length) return null;
  return pickRandom(pool);
}

/** @param {Bollard} entry */
function buildChoices(entry) {
  const wrong = pickDistractors(entry);
  const choices = shuffle([entry.country, ...wrong]);
  if (choices.length !== choiceCount) {
    console.warn(
      `Expected ${choiceCount} choices, got ${choices.length} for ${entry.country} (${entry.continent})`,
    );
  }
  return choices;
}

function applyChoicesLayout() {
  els.choices.dataset.count = String(currentChoices.length);
}

function updateStats() {
  els.score.textContent = String(score);
  els.streak.textContent = String(streak);
  els.round.textContent = String(Math.min(round + 1, maxRounds || round + 1));
  els.totalRounds.textContent = maxRounds ? String(maxRounds) : "∞";
}

function showRound(attempt = 0) {
  if (!dataset) return;
  current = pickQuestion();
  if (!current) {
    els.feedback.textContent =
      "No questions match these settings. Try fewer choices or a less strict distractor mode.";
    els.feedback.className = "feedback wrong-msg";
    return;
  }

  answered = false;
  currentChoices = buildChoices(current);
  if (currentChoices.length < choiceCount && attempt < 10) {
    showRound(attempt + 1);
    return;
  }

  els.image.src = current.imageUrl;
  els.image.alt = `Bollard from ${current.country}`;
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  els.nextBtn.hidden = true;
  els.skipBtn.hidden = false;
  updateMapsLink(current, false);

  if (showContinentHint) {
    els.continentHint.textContent = `Continent: ${current.continent}`;
    els.continentHint.hidden = false;
  } else {
    els.continentHint.hidden = true;
  }

  els.choices.innerHTML = "";
  applyChoicesLayout();
  for (const country of currentChoices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = choiceCount >= 6 ? "choice compact" : "choice";
    btn.textContent = country;
    btn.addEventListener("click", () => onChoice(country, btn));
    els.choices.appendChild(btn);
  }

  updateStats();
}

function lockChoices(correctCountry) {
  const buttons = els.choices.querySelectorAll(".choice");
  for (const btn of buttons) {
    btn.disabled = true;
    const label = btn.textContent;
    if (label === correctCountry) {
      btn.classList.add("correct");
    }
  }
}

/** @param {string} country @param {HTMLButtonElement} btn */
function onChoice(country, btn) {
  if (answered || !current) return;
  answered = true;
  els.skipBtn.hidden = true;
  els.nextBtn.hidden = false;

  const correct = country === current.country;
  if (correct) {
    score++;
    streak++;
    els.feedback.textContent = `Correct — ${current.country}!`;
    els.feedback.className = "feedback correct-msg";
    btn.classList.add("correct");
  } else {
    streak = 0;
    btn.classList.add("wrong");
    els.feedback.textContent = `Wrong — it was ${current.country}.`;
    els.feedback.className = "feedback wrong-msg";
  }

  lockChoices(current.country);
  updateMapsLink(current, true);
  updateStats();
}

function onSkip() {
  if (answered || !current) return;
  answered = true;
  streak = 0;
  els.skipBtn.hidden = true;
  els.nextBtn.hidden = false;
  els.feedback.textContent = `Skipped — answer: ${current.country}.`;
  els.feedback.className = "feedback wrong-msg";
  lockChoices(current.country);
  updateMapsLink(current, true);
  updateStats();
}

function onNext() {
  round++;
  if (maxRounds && round >= maxRounds) {
    endGame();
    return;
  }
  showRound();
}

function startGame() {
  readSettingsFromForm();
  saveSettings();
  buildQuestionPool();

  if (questionPool.length < choiceCount) {
    els.loadingMsg.textContent = `Not enough countries for ${choiceCount} choices. Lower the choice count.`;
    return;
  }

  if (distractorMode === "continent-strict" && !eligibleQuestionPool().length) {
    els.loadingMsg.textContent = `Same-continent-only cannot provide ${choiceCount} choices for any bollard. Use at most 7 choices, or change distractor mode.`;
    return;
  }

  score = 0;
  streak = 0;
  round = 0;

  els.startScreen.hidden = true;
  els.endScreen.hidden = true;
  els.gamePanel.hidden = false;

  showRound();
}

function endGame() {
  els.gamePanel.hidden = true;
  els.endScreen.hidden = false;
  els.finalScore.textContent = String(score);
  els.finalTotal.textContent = String(maxRounds);
  const pct = maxRounds ? Math.round((score / maxRounds) * 100) : 0;
  els.endDetail.textContent =
    maxRounds > 0
      ? `You got ${pct}% correct (${choiceCount} choices, ${distractorLabel()}).`
      : `Endless mode ended.`;
}

async function loadData() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bollards.json`);
    if (!res.ok) throw new Error(res.statusText);
    dataset = await res.json();
    buildQuestionPool();
    els.loadingMsg.textContent = `${dataset.count} bollards · ${dataset.countries.length} countries`;
    els.startBtn.disabled = false;
    updateSettingsPreview();
  } catch (err) {
    els.loadingMsg.textContent = "Failed to load data. Run: pnpm fetch-data";
    console.error(err);
  }
}

for (const el of [
  els.roundsSelect,
  els.choicesSelect,
  els.distractorSelect,
  els.poolSelect,
  els.continentHintCheck,
]) {
  el.addEventListener("change", () => {
    updateSettingsPreview();
    saveSettings();
  });
}

els.startBtn.addEventListener("click", startGame);
els.playAgainBtn.addEventListener("click", () => {
  els.endScreen.hidden = true;
  els.startScreen.hidden = false;
});
els.nextBtn.addEventListener("click", onNext);
els.skipBtn.addEventListener("click", onSkip);

els.gamePanel.hidden = true;
els.startBtn.disabled = true;
loadSettings();
loadData();
