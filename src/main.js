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
/** @type {"choices" | "type"} */
let answerMode = "choices";
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
  distractorSetting: $("distractor-setting"),
  distractorSelect: $("distractor-select"),
  countryList: $("country-list"),
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

/** @param {Bollard | null} entry @param {boolean} visible */
function updateMapsLink(entry, visible) {
  const url = entry && visible ? googleMapsUrl(entry) : null;
  if (!url) {
    els.mapsLink.classList.remove("is-visible");
    els.mapsLink.setAttribute("aria-hidden", "true");
    els.mapsLink.tabIndex = -1;
    els.mapsLink.href = "#";
    els.mapsCoords.textContent = "";
    return;
  }
  els.mapsLink.href = url;
  els.mapsLink.classList.add("is-visible");
  els.mapsLink.setAttribute("aria-hidden", "false");
  els.mapsLink.tabIndex = 0;
  if (entry.lat != null && entry.lng != null) {
    els.mapsCoords.textContent = `${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`;
    els.mapsLink.title = `Street View at ${entry.lat}, ${entry.lng}`;
  } else {
    els.mapsCoords.textContent = "";
    els.mapsLink.title = "Open GeoHints location in Google Maps";
  }
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
  const modeVal = els.choicesSelect.value;
  if (modeVal === "type") {
    answerMode = "type";
  } else {
    answerMode = "choices";
    choiceCount = Math.max(2, Math.min(8, Number(modeVal) || 4));
  }
  distractorMode = /** @type {typeof distractorMode} */ (els.distractorSelect.value);
  poolMode = /** @type {typeof poolMode} */ (els.poolSelect.value);
  showContinentHint = els.continentHintCheck.checked;
  maxRounds = Number(els.roundsSelect.value);
}

function answerModeLabel() {
  return answerMode === "type" ? "type country name" : `${choiceCount} choices`;
}

function updateDistractorSettingVisibility() {
  els.distractorSetting.hidden = answerMode === "type";
}

function normalizeCountry(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** @param {string} input */
function matchCountryInput(input) {
  if (!dataset) return null;
  const norm = normalizeCountry(input);
  if (!norm) return null;
  return dataset.countries.find((c) => normalizeCountry(c) === norm) ?? null;
}

function populateCountryList() {
  if (!dataset || !els.countryList) return;
  els.countryList.innerHTML = "";
  for (const country of dataset.countries) {
    const opt = document.createElement("option");
    opt.value = country;
    els.countryList.appendChild(opt);
  }
}

function distractorLabel() {
  if (distractorMode === "world") return "any country";
  if (distractorMode === "continent-strict") return "same continent only";
  return "same continent first, then worldwide";
}

function updateSettingsPreview() {
  readSettingsFromForm();
  updateDistractorSettingVisibility();
  if (dataset) buildQuestionPool();
  const roundsLabel = maxRounds ? `${maxRounds} rounds` : "endless";
  const poolLabel = poolMode === "unique" ? "one bollard per country" : "all bollards";
  let hint = `${roundsLabel} · ${answerModeLabel()} · ${poolLabel}`;
  if (answerMode === "choices") {
    hint += ` · wrong answers from ${distractorLabel()}`;
  }
  if (answerMode === "choices" && distractorMode === "continent" && choiceCount > 7) {
    hint +=
      " · Note: small continents (e.g. North America has 7 countries) top up extra wrong answers from other continents.";
  }
  if (answerMode === "choices" && distractorMode === "continent-strict" && dataset) {
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
      answerMode,
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
    if (s.answerMode === "type") {
      els.choicesSelect.value = "type";
    } else if (s.choiceCount != null) {
      els.choicesSelect.value = s.choiceCount === 3 ? "4" : String(s.choiceCount);
    }
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
  if (answerMode === "type" || distractorMode !== "continent-strict") return questionPool;
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
  if (answerMode === "type") {
    els.choices.dataset.mode = "type";
    delete els.choices.dataset.count;
  } else {
    els.choices.dataset.mode = "choices";
    els.choices.dataset.count = String(currentChoices.length);
  }
}

function renderTypeAnswer() {
  els.choices.innerHTML = `
    <form class="type-answer" id="type-form">
      <input
        type="text"
        id="country-input"
        class="country-input"
        list="country-list"
        autocomplete="off"
        spellcheck="false"
        placeholder="Type country name…"
        aria-label="Country name"
      />
      <button type="submit" class="btn btn-primary type-submit" id="type-submit">Submit</button>
    </form>
  `;
  const form = $("type-form");
  const input = $("country-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onTypeAnswer(input.value, input);
  });
  input.focus();
}

function finishAnswer(correct, detailMsg, inputEl) {
  if (!current) return;
  answered = true;
  els.skipBtn.hidden = true;
  els.nextBtn.hidden = false;

  if (correct) {
    score++;
    streak++;
    els.feedback.textContent = detailMsg ?? `Correct — ${current.country}!`;
    els.feedback.className = "feedback correct-msg";
    inputEl?.classList.add("correct");
  } else {
    streak = 0;
    els.feedback.textContent = detailMsg ?? `Wrong — it was ${current.country}.`;
    els.feedback.className = "feedback wrong-msg";
    inputEl?.classList.add("wrong");
  }

  if (inputEl) {
    inputEl.disabled = true;
    $("type-submit")?.setAttribute("disabled", "true");
  } else {
    lockChoices(current.country);
  }
  updateMapsLink(current, true);
  updateStats();
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
  if (answerMode === "type") {
    currentChoices = [];
  } else {
    currentChoices = buildChoices(current);
    if (currentChoices.length < choiceCount && attempt < 10) {
      showRound(attempt + 1);
      return;
    }
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
  if (answerMode === "type") {
    renderTypeAnswer();
  } else {
    for (const country of currentChoices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = choiceCount >= 6 ? "choice compact" : "choice";
      btn.textContent = country;
      btn.addEventListener("click", () => onChoice(country, btn));
      els.choices.appendChild(btn);
    }
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
  const correct = country === current.country;
  if (!correct) btn.classList.add("wrong");
  else btn.classList.add("correct");
  finishAnswer(
    correct,
    correct ? `Correct — ${current.country}!` : `Wrong — it was ${current.country}.`,
    null,
  );
}

/** @param {string} value @param {HTMLInputElement} input */
function onTypeAnswer(value, input) {
  if (answered || !current) return;
  const guess = matchCountryInput(value);
  if (!guess) {
    finishAnswer(false, `Not recognized — answer was ${current.country}.`, input);
    return;
  }
  const correct = guess === current.country;
  finishAnswer(
    correct,
    correct
      ? `Correct — ${current.country}!`
      : `Wrong — you said ${guess}, answer was ${current.country}.`,
    input,
  );
}

function onSkip() {
  if (answered || !current) return;
  streak = 0;
  const input = $("country-input");
  if (input) {
    input.disabled = true;
    $("type-submit")?.setAttribute("disabled", "true");
  } else {
    lockChoices(current.country);
  }
  answered = true;
  els.skipBtn.hidden = true;
  els.nextBtn.hidden = false;
  els.feedback.textContent = `Skipped — answer: ${current.country}.`;
  els.feedback.className = "feedback wrong-msg";
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

  if (answerMode === "choices" && questionPool.length < choiceCount) {
    els.loadingMsg.textContent = `Not enough countries for ${choiceCount} choices. Lower the choice count.`;
    return;
  }

  if (
    answerMode === "choices" &&
    distractorMode === "continent-strict" &&
    !eligibleQuestionPool().length
  ) {
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
      ? `You got ${pct}% correct (${answerModeLabel()}).`
      : `Endless mode ended.`;
}

async function loadData() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bollards.json`);
    if (!res.ok) throw new Error(res.statusText);
    dataset = await res.json();
    buildQuestionPool();
    populateCountryList();
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

const homeLink = $("home-link");
if (homeLink) homeLink.href = import.meta.env.BASE_URL;

loadSettings();
loadData();
