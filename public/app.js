import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
import { PROVIDERS, PROVIDER_IDS } from "./providers.js";

// ---------- Languages ----------
const LANGS = [
  ["en-US", "English"],
  ["zh-CN", "中文（普通话）"],
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
let warnedFull = false;
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch {
      if (!warnedFull) { warnedFull = true; toast("本机存储已满，请在「历史」里删除一些旧会议", 6000); }
      return false;
    }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* unavailable */ } },
};

const DEFAULTS = {
  srcLang: "en-US",
  tgtLang: "zh-CN",
  summaryLang: "zh-CN",
  topic: "",
  tts: false,
  autoSummary: false,
  viewMode: "both",
  translateWith: "deepseek",
  summarizeWith: "claude",
  relayUrl: "",
  providers: {},
};
const settings = Object.assign(structuredClone(DEFAULTS), store.get("si.settings", {}));
// Earlier versions stored a single Claude key at the top level.
if (settings.apiKey && !settings.providers.claude) {
  settings.providers.claude = { apiKey: settings.apiKey, model: settings.model || "" };
  delete settings.apiKey; delete settings.model; delete settings.password;
}
const saveSettings = () => store.set("si.settings", settings);
const providerCfg = (id, from = settings) => ({ apiKey: "", model: "", baseURL: "", useRelay: false, ...(from.providers[id] || {}) });

// ---------- Meetings (history) ----------
const newSession = () => ({ id: "m" + Date.now(), startedAt: new Date().toISOString(), segments: [], summary: "" });
const meetingTitle = (s) => new Date(s.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " 会议";

function loadIndex() { return store.get("si.meetings", []); }
function saveIndex(index) { store.set("si.meetings", index); }

function loadInitialSession() {
  const legacy = store.get("si.session", null); // single-session storage from earlier versions
  if (legacy) {
    legacy.id = legacy.id ? "m" + legacy.id : "m" + Date.now();
    store.del("si.session");
    if (legacy.segments?.length) { persist(legacy); return legacy; }
  }
  const currentId = store.get("si.current", null);
  return (currentId && store.get(`si.m.${currentId}`, null)) || newSession();
}

function persist(s = session) {
  if (!s.segments.length && !s.summary) return; // don't list empty meetings
  store.set(`si.m.${s.id}`, s);
  const index = loadIndex().filter((m) => m.id !== s.id);
  index.unshift({
    id: s.id,
    startedAt: s.startedAt,
    count: s.segments.length,
    hasSummary: Boolean(s.summary),
    preview: s.segments[0]?.src.slice(0, 60) ?? "",
  });
  index.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  saveIndex(index);
  store.set("si.current", s.id);
}

let session = loadInitialSession();
const saveSession = () => persist(session);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  srcLang: $("srcLang"), tgtLang: $("tgtLang"), summaryLang: $("summaryLang"), swapBtn: $("swapBtn"),
  segments: $("segments"), interim: $("interim"), empty: $("empty"), main: document.querySelector("main"),
  micBtn: $("micBtn"), newBtn: $("newBtn"), exportBtn: $("exportBtn"), status: $("status"),
  typeForm: $("typeForm"), typeInput: $("typeInput"), viewMode: $("viewMode"),
  summarizeBtn: $("summarizeBtn"), summaryOut: $("summaryOut"), historyList: $("historyList"),
  settingsDlg: $("settings"), settingsBtn: $("settingsBtn"), topic: $("topic"), tts: $("tts"),
  autoSummary: $("autoSummary"), translateWith: $("translateWith"), summarizeWith: $("summarizeWith"),
  providerList: $("providerList"), relayUrl: $("relayUrl"), toast: $("toast"),
};

for (const sel of [els.srcLang, els.tgtLang, els.summaryLang]) {
  for (const [code, name] of LANGS) sel.add(new Option(name, code));
}
for (const sel of [els.translateWith, els.summarizeWith]) {
  for (const id of PROVIDER_IDS) sel.add(new Option(PROVIDERS[id].name, id));
}
els.srcLang.value = settings.srcLang;
els.tgtLang.value = settings.tgtLang;
els.summaryLang.value = settings.summaryLang;
els.viewMode.value = settings.viewMode;
document.body.className = `view-${settings.viewMode}`;
els.newBtn.title = "新会议";
els.newBtn.setAttribute("aria-label", "新会议");

let toastTimer;
function toast(msg, ms = 3500) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}
const setStatus = (msg) => { els.status.textContent = msg; };

// ---------- AI providers ----------
class ProviderError extends Error {
  constructor(provider, status, message) { super(message); this.provider = provider; this.status = status; }
}

function endpointFor(id, cfg) {
  let base = (cfg.baseURL || PROVIDERS[id].baseURL).trim().replace(/\/+$/, "");
  if (cfg.useRelay && settings.relayUrl) base = `${settings.relayUrl.trim().replace(/\/+$/, "")}/${base}`;
  return base;
}

// Streams a completion from provider `id`; returns the full text.
// `cfg` overrides the saved provider settings (used by "Test connection").
async function complete(id, { system, user, maxTokens, effort, onText }, cfg = providerCfg(id)) {
  const def = PROVIDERS[id];
  if (!cfg.apiKey) throw new ProviderError(def.name, 0, `请先在设置中填写 ${def.name} 的 API Key`);
  const model = (cfg.model || def.defaultModel).trim();
  if (!model) throw new ProviderError(def.name, 0, `请先在设置中填写 ${def.name} 的模型名`);
  const base = endpointFor(id, cfg);
  return def.kind === "anthropic"
    ? completeClaude({ base, apiKey: cfg.apiKey, model, system, user, maxTokens, effort, onText })
    : completeOpenAI({ name: def.name, base, apiKey: cfg.apiKey, model, system, user, maxTokens, onText });
}

async function completeClaude({ base, apiKey, model, system, user, maxTokens, effort, onText }) {
  const client = new Anthropic({ apiKey, baseURL: base, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort },
  };
  // Server-side refusal fallback (Opus / Sonnet only).
  if (/^claude-(opus|sonnet)/.test(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const stream = client.beta.messages.stream(params);
  let text = "";
  stream.on("text", (delta) => { text += delta; onText?.(text); });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new ProviderError("Claude", 0, "Claude 拒绝了该请求");
  return text.trim();
}

async function completeOpenAI({ name, base, apiKey, model, system, user, maxTokens, onText }) {
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
  } catch {
    throw new ProviderError(name, -1, `无法连接 ${name}：网络问题，或该服务不允许网页直接调用（可在设置中开启中转）`);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error?.message || j.message || msg; } catch { /* not JSON */ }
    throw new ProviderError(name, res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) throw new ProviderError(name, 0, chunk.error.message || "生成出错");
      const delta = chunk.choices?.[0]?.delta?.content; // reasoning_content is skipped
      if (delta) { text += delta; onText?.(text); }
    }
  }
  return text.trim();
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API Key 无效，请检查设置";
  if (err instanceof Anthropic.PermissionDeniedError) return "Claude 账户没有权限";
  if (err instanceof Anthropic.RateLimitError) return "Claude 请求过于频繁，请稍后重试";
  if (err instanceof Anthropic.APIConnectionError) return "无法连接 Claude：网络问题，或可在设置中开启中转";
  if (err instanceof Anthropic.APIError) return `Claude 错误 ${err.status ?? ""}: ${err.message}`;
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 403) return `${err.provider} API Key 无效或无权限`;
    if (err.status === 402) return `${err.provider} 账户余额不足`;
    if (err.status === 429) return `${err.provider} 请求过于频繁或额度用完，请稍后重试`;
    if (err.status === 404) return `${err.provider} 找不到该模型或接口地址，请检查模型名`;
    if (err.status > 0) return `${err.provider} 错误 ${err.status}: ${err.message}`;
    return err.message;
  }
  return err?.message ?? String(err);
}

const keyMissing = (id) => !providerCfg(id).apiKey;

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
  const owner = session; // the meeting this segment belongs to
  seg.status = "pending";
  seg.error = "";
  renderSegment(seg);
  try {
    const index = owner.segments.indexOf(seg);
    seg.tgt = await complete(settings.translateWith, {
      system: translationSystem(),
      user: translationPrompt(index),
      maxTokens: 2000,
      effort: "low",
      onText: (t) => { seg.tgt = t; if (owner === session) renderSegment(seg); },
    });
    seg.status = "done";
    if (settings.tts && owner === session) speak(seg.tgt);
  } catch (err) {
    seg.status = "error";
    seg.error = describeError(err);
    if (owner === session) toast(seg.error);
  }
  if (owner === session) renderSegment(seg);
  persist(owner);
}

function addSegment(text) {
  text = text.trim();
  if (!text) return;
  const last = session.segments.at(-1);
  // Some recognizers emit the same final result twice.
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
  renderHistory();
}

function renderHistory() {
  const index = loadIndex();
  els.historyList.replaceChildren();
  if (!index.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "还没有会议记录。";
    els.historyList.append(li);
    return;
  }
  for (const m of index) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.className = "open" + (m.id === session.id ? " current" : "");
    const t = document.createElement("span"); t.className = "t";
    t.textContent = meetingTitle(m) + (m.id === session.id ? "（当前）" : "");
    const s = document.createElement("span"); s.className = "s";
    s.textContent = `${m.count} 句 · ${m.hasSummary ? "已总结" : "未总结"}${m.preview ? " · " + m.preview : ""}`;
    open.append(t, s);
    open.addEventListener("click", () => openMeeting(m.id));
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "删除";
    del.addEventListener("click", () => deleteMeeting(m.id));
    li.append(open, del);
    els.historyList.append(li);
  }
}

function openMeeting(id) {
  const s = store.get(`si.m.${id}`, null);
  if (!s) { toast("找不到这场会议"); return; }
  if (listening) stopListening();
  session = s;
  store.set("si.current", id);
  renderAll();
  switchTab("live");
}

function deleteMeeting(id) {
  if (!confirm("删除这场会议的全部原文、译文和总结？此操作无法撤销。")) return;
  store.del(`si.m.${id}`);
  saveIndex(loadIndex().filter((m) => m.id !== id));
  if (id === session.id) {
    if (listening) stopListening();
    session = newSession();
    renderAll();
  } else {
    renderHistory();
  }
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
  if (keyMissing(settings.summarizeWith)) { toast(`请先填写 ${PROVIDERS[settings.summarizeWith].name} 的 API Key`); openSettings(); return; }
  const owner = session;
  summarizing = true;
  els.summarizeBtn.disabled = true;
  els.summarizeBtn.textContent = `正在用 ${PROVIDERS[settings.summarizeWith].name} 总结…`;
  switchTab("summary");
  const transcript = done.map((s, i) =>
    `[${i + 1}] ${fmtTime(s.t)}\n原文: ${s.src}\n译文: ${s.tgt || "(未翻译)"}`).join("\n\n");
  const lang = langName(settings.summaryLang);
  try {
    owner.summary = await complete(settings.summarizeWith, {
      system: [
        "You summarize live-interpreted speeches, meetings, and conversations. The transcript pairs each original speech-recognition segment with its machine interpretation; recognition errors are possible, so rely on context.",
        `Write the summary entirely in ${lang}, in Markdown, using these sections (translate the headings into ${lang}): Overview (2-3 sentences), Key points (bullets), Decisions / conclusions, Action items (owner and deadline when mentioned), Key terms (original term → translation). Omit a section only if there is truly nothing for it. Do not use tables.`,
        settings.topic ? `Context supplied by the user:\n${settings.topic}` : "",
      ].filter(Boolean).join("\n\n"),
      user: `<transcript source_language="${langName(settings.srcLang)}" target_language="${langName(settings.tgtLang)}">\n${transcript}\n</transcript>`,
      maxTokens: 8000,
      effort: "medium",
      onText: (t) => { if (owner === session) renderSummary(t); },
    });
    persist(owner);
    if (owner === session) renderSummary(owner.summary);
    renderHistory();
  } catch (err) {
    toast(describeError(err), 6000);
    if (owner === session) renderSummary(owner.summary);
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
  if (!SR) { toast("此浏览器不支持语音识别，请使用 Safari（iPhone）或 Chrome（安卓），或直接输入文字"); return; }
  if (keyMissing(settings.translateWith)) { toast(`请先填写 ${PROVIDERS[settings.translateWith].name} 的 API Key`); openSettings(); return; }
  listening = true;
  els.micBtn.classList.add("on");
  setStatus(`正在聆听：${langName(settings.srcLang)} → ${langName(settings.tgtLang)} · 翻译：${PROVIDERS[settings.translateWith].name}`);
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
      toast("麦克风权限被拒绝：请在 设置 → Safari → 麦克风 中允许");
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
function buildProviderCards() {
  els.providerList.replaceChildren();
  for (const id of PROVIDER_IDS) {
    const def = PROVIDERS[id];
    const cfg = providerCfg(id);
    const fs = document.createElement("fieldset");
    fs.className = "prov";
    fs.dataset.id = id;
    fs.innerHTML = `
      <legend></legend>
      <input class="key" type="password" autocomplete="off" placeholder="API Key">
      <input class="model" type="text" autocomplete="off" list="models-${id}">
      <datalist id="models-${id}"></datalist>
      <details>
        <summary>高级：接口地址 / 中转</summary>
        <input class="base" type="url" autocomplete="off">
        <small class="hint base-hint"></small>
        <label class="check"><input class="relay" type="checkbox"> 通过中转</label>
      </details>
      <div class="test-row"><button type="button" class="test">测试连接</button><span class="test-result"></span></div>`;
    const legend = fs.querySelector("legend");
    legend.textContent = def.name;
    const link = document.createElement("a");
    link.href = def.keyUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "获取 Key";
    legend.append(link);
    fs.querySelector(".key").value = cfg.apiKey;
    const model = fs.querySelector(".model");
    model.value = cfg.model;
    model.placeholder = def.defaultModel ? `模型（默认 ${def.defaultModel}）` : (def.modelHint || "模型名");
    for (const m of def.models) fs.querySelector("datalist").append(new Option(m, m));
    const base = fs.querySelector(".base");
    base.value = cfg.baseURL;
    base.placeholder = def.baseURL;
    fs.querySelector(".base-hint").textContent = def.baseHint || "";
    fs.querySelector(".relay").checked = cfg.useRelay;
    fs.querySelector(".test").addEventListener("click", () => testProvider(id, fs));
    els.providerList.append(fs);
  }
  markActiveProviders();
}

function markActiveProviders() {
  for (const fs of els.providerList.children) {
    const id = fs.dataset.id;
    fs.classList.toggle("active", id === els.translateWith.value || id === els.summarizeWith.value);
  }
}

function readProviderCard(fs) {
  return {
    apiKey: fs.querySelector(".key").value.trim(),
    model: fs.querySelector(".model").value.trim(),
    baseURL: fs.querySelector(".base").value.trim(),
    useRelay: fs.querySelector(".relay").checked,
  };
}

async function testProvider(id, fs) {
  const out = fs.querySelector(".test-result");
  const btn = fs.querySelector(".test");
  out.className = "test-result";
  out.textContent = "测试中…";
  btn.disabled = true;
  const prevRelay = settings.relayUrl;
  settings.relayUrl = els.relayUrl.value.trim(); // test with the relay currently typed in
  try {
    const text = await complete(id, {
      system: "You are a translator. Output only the translation.",
      user: "Translate into Chinese: Good morning, everyone.",
      maxTokens: 50,
      effort: "low",
    }, readProviderCard(fs));
    out.className = "test-result ok";
    out.textContent = `可用 ✓ ${text.slice(0, 30)}`;
  } catch (err) {
    out.className = "test-result bad";
    out.textContent = describeError(err);
  } finally {
    settings.relayUrl = prevRelay;
    btn.disabled = false;
  }
}

function openSettings() {
  els.translateWith.value = settings.translateWith;
  els.summarizeWith.value = settings.summarizeWith;
  els.relayUrl.value = settings.relayUrl;
  els.topic.value = settings.topic;
  els.tts.checked = settings.tts;
  els.autoSummary.checked = settings.autoSummary;
  buildProviderCards();
  els.settingsDlg.showModal();
}

els.translateWith.addEventListener("change", markActiveProviders);
els.summarizeWith.addEventListener("change", markActiveProviders);

els.settingsDlg.addEventListener("close", () => {
  if (els.settingsDlg.returnValue !== "save") return;
  const providers = {};
  for (const fs of els.providerList.children) providers[fs.dataset.id] = readProviderCard(fs);
  Object.assign(settings, {
    translateWith: els.translateWith.value,
    summarizeWith: els.summarizeWith.value,
    relayUrl: els.relayUrl.value.trim(),
    topic: els.topic.value.trim(),
    tts: els.tts.checked,
    autoSummary: els.autoSummary.checked,
    providers,
  });
  saveSettings();
  toast(`已保存 · 翻译：${PROVIDERS[settings.translateWith].name} · 总结：${PROVIDERS[settings.summarizeWith].name}`);
});

// ---------- Wiring ----------
function switchTab(name) {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
  if (name === "history") renderHistory();
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
  if (listening) stopListening();
  if (session.segments.length) { saveSession(); toast("上一场会议已保存到「历史」"); }
  session = newSession();
  renderAll();
  switchTab("live");
});
els.typeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (keyMissing(settings.translateWith)) { openSettings(); return; }
  addSegment(els.typeInput.value);
  els.typeInput.value = "";
});

renderAll();
if (!SR) setStatus("此浏览器不支持语音识别，可输入文字翻译");
if (keyMissing(settings.translateWith)) openSettings();
