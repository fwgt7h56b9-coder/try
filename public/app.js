import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";

// ---------- Languages ----------
const LANGS = [
  ["zh-CN", "中文（普通话）"],
  ["en-US", "English"],
  ["ja-JP", "日本語"],
  ["ko-KR", "한국어"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["es-ES", "Español"],
  ["ru-RU", "Русский"],
  ["pt-BR", "Português"],
  ["it-IT", "Italiano"],
  ["ar-SA", "العربية"],
  ["th-TH", "ไทย"],
  ["vi-VN", "Tiếng Việt"],
  ["id-ID", "Bahasa Indonesia"],
  ["zh-HK", "粵語"],
];
const langName = (code) => LANGS.find(([c]) => c === code)?.[1] ?? code;

// ---------- Storage (best effort) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const settings = Object.assign({
  apiKey: "",
  password: "",
  model: "claude-opus-5-5",
  srcLang: "en-US",
  tgtLang: "zh-CN",
  summaryLang: "zh-CN",
  topic: "",
  tts: false,
  autoSummary: false,
  viewMode: "both",
}, store.get("si.settings", {}));

const newSession = () => ({ id: Date.now(), startedAt: new Date().toISOString(), segments: [], summary: "" });
let session = store.get("si.session", null) ?? newSession();
const saveSession = () => store.set("si.session", session);
const saveSettings = () => store.set("si.settings", settings);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  srcLang: $("srcLang"), tgtLang: $("tgtLang"), summaryLang: $("summaryLang"), swapBtn: $("swapBtn"),
  segments: $("segments"), interim: $("interim"), empty: $("empty"), main: document.querySelector("main"),
  micBtn: $("micBtn"), newBtn: $("newBtn"), exportBtn: $("exportBtn"), status: $("status"),
  typeForm: $("typeForm"), typeInput: $("typeInput"), viewMode: $("viewMode"),
  summarizeBtn: $("summarizeBtn"), summaryOut: $("summaryOut"),
  settingsDlg: $("settings"), settingsBtn: $("settingsBtn"), apiKey: $("apiKey"), password: $("password"),
  model: $("model"), topic: $("topic"), tts: $("tts"), autoSummary: $("autoSummary"),
  keyRow: $("keyRow"), pwRow: $("pwRow"), proxyNote: $("proxyNote"), toast: $("toast"),
};

for (const sel of [els.srcLang, els.tgtLang, els.summaryLang]) {
  for (const [code, name] of LANGS) sel.add(new Option(name, code));
}
els.srcLang.value = settings.srcLang;
els.tgtLang.value = settings.tgtLang;
els.summaryLang.value = settings.summaryLang;
els.viewMode.value = settings.viewMode;
document.body.className = `view-${settings.viewMode}`;

let toastTimer;
function toast(msg, ms = 3500) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}
const setStatus = (msg) => { els.status.textContent = msg; };

// ---------- Claude client ----------
// Proxy mode: when served by server.js, requests go to ./api/v1/messages and the
// server adds the API key. Otherwise (e.g. GitHub Pages) the user's own key is used.
let proxy = { enabled: false, passwordRequired: false };

async function detectProxy() {
  try {
    const res = await fetch("api/config", { cache: "no-store" });
    if (res.ok) proxy = { enabled: true, ...(await res.json()) };
  } catch { /* static hosting */ }
}

function getClient() {
  if (proxy.enabled) {
    return new Anthropic({
      apiKey: "server-side",
      baseURL: new URL("api", location.href).href.replace(/\/$/, ""),
      dangerouslyAllowBrowser: true,
      defaultHeaders: settings.password ? { "x-app-password": settings.password } : {},
    });
  }
  if (!settings.apiKey) return null;
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
}

function needsSetup() {
  if (proxy.enabled) return proxy.passwordRequired && !settings.password;
  return !settings.apiKey;
}

// Streams a reply into onText; returns the full text.
async function streamClaude({ system, user, maxTokens, effort, onText }) {
  const client = getClient();
  if (!client) throw new Error("请先在设置中填写 API Key");
  const params = {
    model: settings.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort },
  };
  // Server-side refusal fallback (Opus / Sonnet only; Haiku has none).
  if (settings.model !== "claude-haiku-5-5") {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const stream = client.beta.messages.stream(params);
  let text = "";
  stream.on("text", (delta) => { text += delta; onText?.(text); });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude 拒绝了该请求");
  return text.trim();
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return proxy.enabled ? "服务器 API Key 无效" : "API Key 无效，请检查设置";
  if (err instanceof Anthropic.PermissionDeniedError) return "没有权限（访问密码错误或账户无权限）";
  if (err instanceof Anthropic.RateLimitError) return "请求过于频繁，请稍后重试";
  if (err instanceof Anthropic.APIConnectionError) return "网络连接失败";
  if (err instanceof Anthropic.APIError) return `API 错误 ${err.status ?? ""}: ${err.message}`;
  return err?.message ?? String(err);
}

// ---------- Translation ----------
function translationSystem() {
  return [
    `You are a professional simultaneous interpreter translating live speech from ${langName(settings.srcLang)} into ${langName(settings.tgtLang)}.`,
    "The input comes from automatic speech recognition: it may lack punctuation, split sentences oddly, or contain homophone errors. Infer the speaker's intended meaning from context and translate that.",
    "Translate naturally and fluently, the way a skilled human interpreter would speak, keeping names, numbers, and terminology accurate and consistent with earlier segments.",
    "Output only the translation of the current segment, with no quotes, notes, or explanations.",
    settings.topic ? `Context and glossary supplied by the user:\n${settings.topic}` : "",
  ].filter(Boolean).join("\n\n");
}

function translationPrompt(index) {
  const prev = session.segments.slice(Math.max(0, index - 4), index).filter((s) => s.tgt);
  const ctx = prev.map((s) => `${s.src}\n→ ${s.tgt}`).join("\n\n");
  return (ctx ? `<previous_segments>\n${ctx}\n</previous_segments>\n\n` : "") +
    `<current_segment>\n${session.segments[index].src}\n</current_segment>`;
}

async function translate(seg) {
  seg.status = "pending";
  seg.error = "";
  renderSegment(seg);
  try {
    const index = session.segments.indexOf(seg);
    seg.tgt = await streamClaude({
      system: translationSystem(),
      user: translationPrompt(index),
      maxTokens: 4000,
      effort: "low",
      onText: (t) => { seg.tgt = t; renderSegment(seg); },
    });
    seg.status = "done";
    if (settings.tts) speak(seg.tgt);
  } catch (err) {
    seg.status = "error";
    seg.error = describeError(err);
    toast(seg.error);
  }
  renderSegment(seg);
  saveSession();
}

function addSegment(text) {
  text = text.trim();
  if (!text) return;
  const last = session.segments.at(-1);
  // Some Android builds emit the same final result twice.
  if (last && last.src === text && Date.now() - last.t < 3000) return;
  const seg = { id: `${Date.now()}-${session.segments.length}`, t: Date.now(), src: text, tgt: "", status: "pending" };
  session.segments.push(seg);
  saveSession();
  renderSegment(seg);
  translate(seg);
}

// ---------- Rendering ----------
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function nearBottom() {
  const m = els.main;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 120;
}

function renderSegment(seg) {
  const stick = nearBottom();
  let li = document.getElementById(`seg-${seg.id}`);
  if (!li) {
    li = document.createElement("li");
    li.className = "seg";
    li.id = `seg-${seg.id}`;
    li.innerHTML = `<div class="meta"><span class="time"></span><button class="retry" hidden>重试</button></div><div class="src"></div><div class="tgt"></div>`;
    li.querySelector(".retry").addEventListener("click", () => translate(seg));
    els.segments.append(li);
  }
  li.querySelector(".time").textContent = fmtTime(seg.t);
  li.querySelector(".src").textContent = seg.src;
  const tgt = li.querySelector(".tgt");
  tgt.textContent = seg.status === "error" ? seg.error : seg.tgt;
  tgt.className = `tgt ${seg.status === "pending" ? "pending" : ""} ${seg.status === "error" ? "error" : ""}`;
  li.querySelector(".retry").hidden = seg.status !== "error";
  els.empty.hidden = true;
  if (stick) els.main.scrollTop = els.main.scrollHeight;
}

function renderAll() {
  els.segments.replaceChildren();
  els.empty.hidden = session.segments.length > 0;
  for (const seg of session.segments) {
    if (seg.status === "pending") {
      seg.status = "error";
      seg.error = "翻译中断，点击重试";
    }
    renderSegment(seg);
  }
  renderSummary(session.summary);
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Minimal Markdown: headings, bullet/numbered lists, bold, paragraphs.
function renderMarkdown(md) {
  const out = [];
  let list = null;
  const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      const level = Math.min(m[1].length + 1, 4);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

function renderSummary(md) {
  els.summaryOut.innerHTML = md
    ? renderMarkdown(md)
    : '<p class="hint">暂无总结。传译内容会被整理为：概要、要点、结论、待办事项和术语对照。</p>';
}

// ---------- Summary ----------
let summarizing = false;
async function summarize() {
  if (summarizing) return;
  const done = session.segments.filter((s) => s.src);
  if (!done.length) { toast("还没有传译内容"); return; }
  if (needsSetup()) { openSettings(); return; }
  summarizing = true;
  els.summarizeBtn.disabled = true;
  els.summarizeBtn.textContent = "正在总结…";
  switchTab("summary");
  const transcript = done.map((s, i) =>
    `[${i + 1}] ${fmtTime(s.t)}\n原文: ${s.src}\n译文: ${s.tgt || "(未翻译)"}`).join("\n\n");
  const lang = langName(settings.summaryLang);
  try {
    session.summary = await streamClaude({
      system: [
        "You summarize live-interpreted speeches, meetings, and conversations. The transcript pairs each original speech-recognition segment with its machine interpretation; recognition errors are possible, so rely on context.",
        `Write the summary entirely in ${lang}, in Markdown, using these sections (translate the headings into ${lang}): Overview (2-3 sentences), Key points (bullets), Decisions / conclusions, Action items (owner and deadline when mentioned), Key terms (original term → translation). Omit a section only if there is truly nothing for it. Do not use tables.`,
        settings.topic ? `Context supplied by the user:\n${settings.topic}` : "",
      ].filter(Boolean).join("\n\n"),
      user: `<transcript source_language="${langName(settings.srcLang)}" target_language="${langName(settings.tgtLang)}">\n${transcript}\n</transcript>`,
      maxTokens: 16000,
      effort: "medium",
      onText: (t) => renderSummary(t),
    });
    renderSummary(session.summary);
    saveSession();
  } catch (err) {
    toast(describeError(err));
    renderSummary(session.summary);
  } finally {
    summarizing = false;
    els.summarizeBtn.disabled = false;
    els.summarizeBtn.textContent = "生成 / 更新总结";
  }
}

// ---------- Speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let wakeLock = null;

function startListening() {
  if (!SR) { toast("此浏览器不支持语音识别，请使用 Chrome（安卓）或 Safari（iOS），或直接输入文字"); return; }
  if (needsSetup()) { openSettings(); return; }
  listening = true;
  els.micBtn.classList.add("on");
  setStatus(`正在聆听：${langName(settings.srcLang)} → ${langName(settings.tgtLang)}`);
  navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {});
  startRecognizer();
}

function startRecognizer() {
  recognition = new SR();
  recognition.lang = settings.srcLang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addSegment(r[0].transcript);
      else interim += r[0].transcript;
    }
    els.interim.textContent = interim;
    els.interim.hidden = !interim;
    if (interim && nearBottom()) els.main.scrollTop = els.main.scrollHeight;
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("麦克风权限被拒绝，请在浏览器设置中允许");
      stopListening();
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      setStatus(`识别错误：${e.error}，正在重连…`);
    }
  };
  // Browsers end recognition after silence or ~60s; restart while still listening.
  recognition.onend = () => {
    if (listening) setTimeout(() => { if (listening) { try { startRecognizer(); } catch { /* retry next end */ } } }, 250);
  };
  recognition.start();
}

function stopListening() {
  const was = listening;
  listening = false;
  els.micBtn.classList.remove("on");
  els.interim.hidden = true;
  try { recognition?.stop(); } catch { /* already stopped */ }
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  setStatus("已停止");
  if (was && settings.autoSummary && session.segments.length) summarize();
}

// Re-acquire the wake lock after the page becomes visible again.
document.addEventListener("visibilitychange", () => {
  if (listening && document.visibilityState === "visible") {
    navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {});
  }
});

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = settings.tgtLang;
  speechSynthesis.speak(u);
}

// ---------- Export ----------
function exportMarkdown() {
  if (!session.segments.length) { toast("没有可导出的内容"); return; }
  const lines = [
    `# 同声传译记录`,
    ``,
    `- 开始时间：${new Date(session.startedAt).toLocaleString()}`,
    `- 语言：${langName(settings.srcLang)} → ${langName(settings.tgtLang)}`,
    `- 模型：${settings.model}`,
    ``,
  ];
  if (session.summary) lines.push(`## 总结`, ``, session.summary, ``);
  lines.push(`## 原文与译文`, ``);
  session.segments.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${fmtTime(s.t)}`, ``, `**原文：** ${s.src}`, ``, `**译文：** ${s.tgt || "(未翻译)"}`, ``);
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `传译记录-${new Date(session.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Settings ----------
function openSettings() {
  els.apiKey.value = settings.apiKey;
  els.password.value = settings.password;
  els.model.value = settings.model;
  els.topic.value = settings.topic;
  els.tts.checked = settings.tts;
  els.autoSummary.checked = settings.autoSummary;
  els.keyRow.hidden = proxy.enabled;
  els.proxyNote.hidden = !proxy.enabled;
  els.pwRow.hidden = !proxy.passwordRequired;
  els.settingsDlg.showModal();
}

els.settingsDlg.addEventListener("close", () => {
  if (els.settingsDlg.returnValue !== "save") return;
  Object.assign(settings, {
    apiKey: els.apiKey.value.trim(),
    password: els.password.value,
    model: els.model.value,
    topic: els.topic.value.trim(),
    tts: els.tts.checked,
    autoSummary: els.autoSummary.checked,
  });
  saveSettings();
  toast("设置已保存");
});

// ---------- Wiring ----------
function switchTab(name) {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
}
document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

function onLangChange() {
  settings.srcLang = els.srcLang.value;
  settings.tgtLang = els.tgtLang.value;
  saveSettings();
  if (listening) { try { recognition?.abort(); } catch { /* restarts via onend */ } }
}
els.srcLang.addEventListener("change", onLangChange);
els.tgtLang.addEventListener("change", onLangChange);
els.swapBtn.addEventListener("click", () => {
  [els.srcLang.value, els.tgtLang.value] = [els.tgtLang.value, els.srcLang.value];
  onLangChange();
});
els.summaryLang.addEventListener("change", () => { settings.summaryLang = els.summaryLang.value; saveSettings(); });
els.viewMode.addEventListener("change", () => {
  settings.viewMode = els.viewMode.value;
  document.body.className = `view-${settings.viewMode}`;
  saveSettings();
});

els.micBtn.addEventListener("click", () => (listening ? stopListening() : startListening()));
els.summarizeBtn.addEventListener("click", summarize);
els.exportBtn.addEventListener("click", exportMarkdown);
els.settingsBtn.addEventListener("click", openSettings);
els.newBtn.addEventListener("click", () => {
  if (session.segments.length && !confirm("开始新会话？当前记录将被清空（可先导出）。")) return;
  if (listening) stopListening();
  session = newSession();
  saveSession();
  renderAll();
  switchTab("live");
});
els.typeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (needsSetup()) { openSettings(); return; }
  addSegment(els.typeInput.value);
  els.typeInput.value = "";
});

renderAll();
await detectProxy();
if (!SR) setStatus("此浏览器不支持语音识别，可输入文字翻译");
if (needsSetup()) openSettings();
