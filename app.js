/* LiveTalk Translator
 * Native (Capacitor APK): @capacitor-community/speech-recognition + text-to-speech
 * Browser / PWA (Chrome): Web Speech API fallback
 */

// ---------- State ----------
const HISTORY_KEY = "livetalk_history";
const MAX_HISTORY = 100;

let activeSpeaker = null; // 1 | 2 | null
let isListening = false;
let isBusy = false; // translating / speaking pipeline

const Cap = window.Capacitor;
const isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());

const pluginCache = {};
function getPlugin(name) {
  if (pluginCache[name]) return pluginCache[name];
  const p = (Cap.Plugins && Cap.Plugins[name]) || Cap.registerPlugin(name);
  pluginCache[name] = p;
  return p;
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const lang1Select = $("lang1-select");
const lang2Select = $("lang2-select");
const swapBtn = $("swap-lang-btn");
const mic1Btn = $("mic1-btn");
const mic2Btn = $("mic2-btn");
const mic1Label = $("mic1-label");
const mic2Label = $("mic2-label");
const statusCard = $("status-card");
const statusText = $("status-text");
const chatStream = $("chat-stream");
const clearHistoryBtn = $("clear-history-btn");
const toastEl = $("toast");

// ---------- UI helpers ----------
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function setStatus(state, text) {
  statusCard.className = `status-card ${state}`;
  statusText.textContent = text;
}

function setIdle() {
  setStatus("idle", "Tap a microphone to speak");
}

function setMicState(speaker) {
  mic1Btn.classList.toggle("active", speaker === 1);
  mic2Btn.classList.toggle("active", speaker === 2);
  // While translating, block both mics; while listening, only the active one stays tappable (to stop)
  mic1Btn.disabled = isBusy || (isListening && speaker !== 1);
  mic2Btn.disabled = isBusy || (isListening && speaker !== 2);
}

function showPlaceholder(text) {
  chatStream.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "chat-placeholder";
  wrap.innerHTML = '<i class="fa-solid fa-comments"></i>';
  const p = document.createElement("p");
  p.textContent = text;
  wrap.appendChild(p);
  chatStream.appendChild(wrap);
}

function updateLabels() {
  const name1 = lang1Select.options[lang1Select.selectedIndex].text.split(" ")[0];
  const name2 = lang2Select.options[lang2Select.selectedIndex].text.split(" ")[0];
  mic1Label.textContent = `Speak ${name1}`;
  mic2Label.textContent = `Speak ${name2}`;
}

lang1Select.addEventListener("change", updateLabels);
lang2Select.addEventListener("change", updateLabels);
swapBtn.addEventListener("click", () => {
  const tmp = lang1Select.value;
  lang1Select.value = lang2Select.value;
  lang2Select.value = tmp;
  updateLabels();
});

// ---------- Speech recognition ----------
let webRecognition = null;

async function listenNative(speechLang) {
  const SR = getPlugin("SpeechRecognition");
  const { available } = await SR.available();
  if (!available) throw new Error("Speech recognition isn't available on this device. Install or enable the Google app.");

  let perm = await SR.checkPermissions();
  if (perm.speechRecognition !== "granted") {
    perm = await SR.requestPermissions();
    if (perm.speechRecognition !== "granted") {
      throw new Error("Microphone permission denied. Enable it in Settings > Apps > LiveTalk.");
    }
  }

  const result = await SR.start({
    language: speechLang,
    maxResults: 1,
    prompt: "Speak now",
    partialResults: false,
    popup: false,
  });
  return (result && result.matches && result.matches[0]) || "";
}

function listenWeb(speechLang) {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error("Speech recognition isn't supported here. Use Chrome on Android, or the installed APK."));
      return;
    }
    const rec = new SpeechRecognition();
    webRecognition = rec;
    rec.lang = speechLang;
    rec.continuous = false;
    rec.interimResults = false;

    let transcript = "";
    let failed = false;
    rec.onresult = (e) => { transcript = e.results[0][0].transcript; };
    rec.onerror = (e) => {
      failed = true;
      reject(new Error(e.error === "no-speech" ? "No speech detected. Try again." : `Microphone error: ${e.error}`));
    };
    rec.onend = () => { if (!failed) resolve(transcript); };
    try { rec.start(); } catch (err) { reject(err); }
  });
}

async function stopListening() {
  try {
    if (isNative) await getPlugin("SpeechRecognition").stop();
    else if (webRecognition) webRecognition.stop();
  } catch (e) { console.warn("stop failed", e); }
}

async function handleMic(speaker) {
  if (isBusy) return;

  // Tapping the active mic again stops listening
  if (isListening && activeSpeaker === speaker) {
    await stopListening();
    return;
  }
  if (isListening) return;

  activeSpeaker = speaker;
  isListening = true;
  setMicState(speaker);
  setStatus("listening", "Listening… speak now");

  const speechLang = (speaker === 1 ? lang1Select.value : lang2Select.value).split("|")[0];

  let transcript = "";
  try {
    transcript = isNative ? await listenNative(speechLang) : await listenWeb(speechLang);
  } catch (err) {
    console.error(err);
    isListening = false;
    setMicState(null);
    setStatus("error", err.message || "Microphone error");
    return;
  }

  isListening = false;

  if (!transcript || !transcript.trim()) {
    setMicState(null);
    setStatus("error", "Didn't catch that. Tap the mic and try again.");
    return;
  }

  isBusy = true;
  setMicState(null);
  setStatus("busy", "Translating…");
  try {
    await processTranslation(transcript.trim(), speaker);
    setIdle();
  } catch (err) {
    console.error(err);
    setStatus("error", "Translation failed. Check your internet connection.");
  } finally {
    isBusy = false;
    setMicState(null);
  }
}

mic1Btn.addEventListener("click", () => handleMic(1));
mic2Btn.addEventListener("click", () => handleMic(2));

// ---------- Translation ----------
async function translateGoogle(text, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  const out = data[0].map((item) => item[0]).join("");
  if (!out) throw new Error("Empty translation");
  return out;
}

async function translateMyMemory(text, sl, tl) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out) throw new Error("Empty translation");
  return out;
}

async function translate(text, sl, tl) {
  if (sl === tl) return text;
  try {
    return await translateGoogle(text, sl, tl);
  } catch (e) {
    console.warn("Primary translator failed, trying fallback:", e);
    return await translateMyMemory(text, sl, tl);
  }
}

async function processTranslation(sourceText, speaker) {
  const p1 = lang1Select.value.split("|");
  const p2 = lang2Select.value.split("|");
  const src = speaker === 1 ? p1 : p2;
  const dst = speaker === 1 ? p2 : p1;

  const translated = await translate(sourceText, src[1], dst[1]);

  renderMessage({
    speaker,
    original: sourceText,
    translated,
    targetSpeechTag: dst[0],
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }, true);

  // Don't block the UI on playback
  speakText(translated, dst[0]);
}

// ---------- Text to speech ----------
async function speakText(text, langCode) {
  try {
    if (isNative) {
      const TTS = getPlugin("TextToSpeech");
      await TTS.stop().catch(() => {});
      await TTS.speak({ text, lang: langCode, rate: 0.95, pitch: 1.0, volume: 1.0, category: "ambient" });
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langCode;
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    }
  } catch (err) {
    console.warn("TTS failed:", err);
    toast("Couldn't play audio. Install the voice for this language in Android settings.");
  }
}

// ---------- Rendering & history ----------
function renderMessage(msg, persist) {
  const placeholder = chatStream.querySelector(".chat-placeholder");
  if (placeholder) placeholder.remove();

  const card = document.createElement("div");
  card.className = `message-card ${msg.speaker === 1 ? "p1" : "p2"}`;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const who = document.createElement("span");
  who.textContent = msg.speaker === 1 ? "Person 1" : "Person 2";
  const time = document.createElement("span");
  time.textContent = msg.timestamp;
  meta.append(who, time);

  const orig = document.createElement("div");
  orig.className = "msg-original";
  orig.textContent = msg.original;

  const trans = document.createElement("div");
  trans.className = "msg-translated";
  trans.textContent = msg.translated;

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const speakBtn = document.createElement("button");
  speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  speakBtn.title = "Play";
  speakBtn.addEventListener("click", () => speakText(msg.translated, msg.targetSpeechTag));
  const copyBtn = document.createElement("button");
  copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
  copyBtn.title = "Copy";
  copyBtn.addEventListener("click", () => copyText(msg.translated));
  actions.append(speakBtn, copyBtn);

  card.append(meta, orig, trans, actions);
  chatStream.appendChild(card);
  chatStream.scrollTop = chatStream.scrollHeight;

  if (persist) saveToStorage(msg);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied to clipboard"); }
    catch (_) { toast("Couldn't copy"); }
    ta.remove();
  }
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch (e) { return []; }
}

function saveToStorage(msg) {
  try {
    const history = readHistory();
    history.push(msg);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch (e) { console.warn("Storage unavailable", e); }
}

function loadHistory() {
  const history = readHistory();
  if (history.length === 0) {
    showPlaceholder("No conversation yet. Choose your languages and tap either mic.");
    return;
  }
  chatStream.innerHTML = "";
  history.forEach((m) => renderMessage(m, false));
}

clearHistoryBtn.addEventListener("click", () => {
  if (confirm("Delete all conversation history?")) {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    showPlaceholder("Conversation cleared.");
  }
});

// ---------- Init ----------
updateLabels();
loadHistory();
setIdle();
setMicState(null);
