/* BoomBooth booth logic.
   Quests are scripted in /content/content.json and chosen by fixed routing rules.
   AI is only used to (1) map free speech/typing to an allowed option and (2) write the printed summary.
   Every action after a wristband scan is logged for pain-point analysis. */
{
  // ---------- small helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fill = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  const now = () => new Date().toISOString();
  const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  async function postJSON(url, body, timeoutMs = 8000, keepalive = false) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal, keepalive });
      return r;
    } finally { clearTimeout(t); }
  }

  // ---------- state ----------
  let C = null;                 // content file
  let cfg = { ai: false, tts: false, storage: false };
  const settings = Object.assign({ voice: "browser", decide: "ai", summary: "ai", size: "normal" }, store.get("bb_settings", {}));
  let consented = false;
  let offhook = false;
  let call = null;              // active call
  let wristband = store.get("bb_wristband", null) || newBandId();
  store.set("bb_wristband", wristband);

  const ui = {
    crt: $("#crt"), speaker: $("#speaker"), caption: $("#caption"), sub: $("#sub"), options: $("#options"), foot: $("#crtfoot"),
    callinfo: $("#callinfo"), handset: $("#handset"), handsetLabel: $("#handset-label"), lamp: $("#lamp"),
    reader: $("#reader"), tap: $("#tap"), newband: $("#newband"), bandId: $("#band-id"), bandVisual: $("#band-id-visual"),
    mic: $("#mic"), micLabel: $("#mic-label"), freetext: $("#freetext"), send: $("#send"), heard: $("#heard"),
    receiptArea: $("#receipt-area"), services: $("#services"), consent: $("#consent"),
  };

  function newBandId() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return "WB-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => a[b % a.length]).join("");
  }
  function showBand() { ui.bandId.textContent = wristband; ui.bandVisual.textContent = wristband; }

  // ---------- logging ----------
  const queue = [];
  function log(type, data = {}) {
    if (!call || !call.session) return;
    queue.push({ type, at: now(), screen: call.screen || null, wristband_id: call.session.wristband_id, data });
  }
  async function flush(final = false) {
    if (!call || !call.session || !cfg.storage) { queue.length = 0; return; }
    const events = queue.splice(0, 200);
    try {
      const r = await postJSON("/api/log", { session: call.session, events }, 8000, final);
      if (!r.ok && !final) queue.unshift(...events);
    } catch { if (!final) queue.unshift(...events); }
  }
  setInterval(() => { if (queue.length) flush(); }, 3000);

  // ---------- wristband progress ----------
  const freshProfile = () => ({ class_id: null, quiz_scores: null, needs: {}, branch_id: null, step_index: 0, step_started_at: null,
    completed: [], steps_done: [], echoes: [], helper_topics: [], swaps: 0 });
  let saveTimer = null;
  function saveProfile() {
    if (!call || !call.session.wristband_id) return;
    const wb = call.session.wristband_id, p = call.profile;
    store.set("bb_state_" + wb, p);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (cfg.storage) postJSON("/api/state", { wristband_id: wb, state: p }).catch(() => {}); }, 600);
  }
  async function loadProfile(wb) {
    if (cfg.storage) {
      try {
        const r = await fetch("/api/state?wristband=" + encodeURIComponent(wb));
        if (r.ok) { const j = await r.json(); if (j.state) return j.state; }
      } catch { /* fall back to this browser */ }
    }
    return store.get("bb_state_" + wb, null);
  }

  // ---------- voice ----------
  let speakToken = 0, audioEl = null;
  const audioCache = new Map();
  function stopSpeech() {
    speakToken++;
    try { speechSynthesis.cancel(); } catch { /* none */ }
    if (audioEl) { audioEl.pause(); audioEl = null; }
  }
  function voiceFor(speakerKey) { return (C.voices && C.voices[speakerKey]) || C.voices.operator; }
  function speak(text, speakerKey, onEnd) {
    stopSpeech();
    const token = speakToken;
    const done = () => { if (token === speakToken && onEnd) onEnd(); };
    if (!text || settings.voice === "off") { done(); return; }
    if (settings.voice === "gemini" && cfg.tts) { geminiSpeak(text, speakerKey, token, done); return; }
    browserSpeak(text, speakerKey, done);
  }
  function browserSpeak(text, speakerKey, done) {
    if (!("speechSynthesis" in window)) { done(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en-GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
    const pitch = { operator: 1, class_1: 1.15, class_2: 0.9, class_3: 0.8, class_4: 1.25, echo: 0.85 };
    u.pitch = pitch[speakerKey] ?? 1; u.rate = 0.95;
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  }
  async function geminiSpeak(text, speakerKey, token, done) {
    const v = voiceFor(speakerKey);
    const key = (v.gemini_voice || "Kore") + "|" + text;
    try {
      let url = audioCache.get(key);
      if (!url) {
        const r = await postJSON("/api/tts", { text, voice: v.gemini_voice, style: v.voice_hint }, 25000);
        if (!r.ok) throw new Error("tts");
        url = URL.createObjectURL(await r.blob());
        audioCache.set(key, url);
      }
      if (token !== speakToken) return;
      audioEl = new Audio(url);
      audioEl.onended = done; audioEl.onerror = done;
      await audioEl.play();
    } catch {
      if (token === speakToken) browserSpeak(text, speakerKey, done);
    }
  }

  // ---------- prompts ----------
  let silenceTimer = null;
  function clearSilence() { clearTimeout(silenceTimer); silenceTimer = null; }
  function spokenFor(p) {
    let t = p.text;
    if (p.speakOptions && p.options.length) t += " " + p.options.map((o) => `Press ${o.key} for ${o.label}.`).join(" ");
    return t;
  }
  /* p: {id, speaker, text, sub, options:[{key,label,value,hints,locked}], onPick(opt, via), speakOptions, free, screen, zero} */
  function ask(p) {
    if (!call) return;
    clearSilence();
    p.options = p.options || [];
    p.free = p.free !== false && p.options.length > 0;
    p.zero = p.zero !== false;
    p.shownAt = Date.now();
    p.nudged = false;
    call.prompt = p;
    if (p.screen) call.screen = p.screen;
    log("prompt_shown", { prompt_id: p.id });
    render(p);
    speak(spokenFor(p), p.speaker || "operator", () => armSilence(p));
  }
  function render(p) {
    const v = voiceFor(p.speaker || "operator");
    ui.crt.classList.toggle("safety", !!p.safety);
    ui.speaker.textContent = v.name;
    ui.caption.textContent = p.text;
    ui.sub.textContent = p.sub || "";
    ui.options.innerHTML = p.options.map((o) =>
      `<li><button type="button" data-key="${esc(o.key)}" class="${o.locked ? "locked" : ""}"><span class="k">${esc(o.key === "#" ? "#" : o.key === "*" ? "✱" : o.key)}</span><span>${esc(o.label)}${o.locked ? " (locked)" : ""}</span></button></li>`).join("");
    const extra = [];
    if (p.id !== "scan") extra.push("9 repeat");
    if (p.zero && call && call.session) extra.push("0 Operator");
    ui.foot.textContent = extra.join(" · ");
    setFreeInput(p.free);
    updateCallInfo();
  }
  function armSilence(p) {
    clearSilence();
    if (!call || call.prompt !== p || p.nudged || !p.options.length) return;
    silenceTimer = setTimeout(() => {
      if (!call || call.prompt !== p) return;
      p.nudged = true;
      log("silence", { prompt_id: p.id, seconds: Math.round((Date.now() - p.shownAt) / 1000) });
      const optionsLine = p.options.map((o) => `Press ${o.key} for ${o.label}.`).join(" ");
      speak(C.operator.silence_nudge + " " + optionsLine, "operator");
    }, (C.meta.silence_repeat_seconds || 8) * 1000);
  }
  function repeat() {
    const p = call && call.prompt;
    if (!p) return;
    log("repeat", { prompt_id: p.id });
    p.shownAt = Date.now(); p.nudged = false;
    speak(spokenFor(p), p.speaker || "operator", () => armSilence(p));
  }
  function choose(opt, via, extra) {
    const p = call && call.prompt;
    if (!p) return;
    clearSilence(); stopSpeech();
    const seconds = Math.round((Date.now() - p.shownAt) / 1000);
    if (p.id !== "scan" && p.id !== "confirm") log("choice", { prompt_id: p.id, key: opt.key, value: opt.value ?? null, via, seconds, ...(extra || {}) });
    p.onPick(opt, via);
  }

  // ---------- keypad ----------
  function pressKey(k) {
    const btn = document.querySelector(`.keypad [data-key="${CSS.escape(k)}"]`);
    if (btn) { btn.classList.add("pressed"); setTimeout(() => btn.classList.remove("pressed"), 140); }
    if (!offhook) { ui.caption.textContent = "Pick up the handset first."; return; }
    if (!call || !call.prompt) return;
    const p = call.prompt;
    const opt = p.options.find((o) => o.key === k);
    if (opt) return choose(opt, "key");
    if (k === "9") return repeat();
    if (k === "0" && p.zero && call.session) { log("back_to_operator", { from_prompt: p.id }); return menu(); }
  }
  document.querySelectorAll(".keypad button").forEach((b) => b.addEventListener("click", () => pressKey(b.dataset.key)));
  ui.options.addEventListener("click", (e) => { const b = e.target.closest("button[data-key]"); if (b) pressKey(b.dataset.key); });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, summary") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!ui.consent.hidden) return;
    if (/^[0-9*#]$/.test(e.key)) { e.preventDefault(); pressKey(e.key); }
  });

  // ---------- free speech / typing ----------
  const NEG = /\b(not|no|don'?t|never|nah|rather not|without)\b[\w\s']{0,12}$/i;
  const NUM = { one: "1", first: "1", two: "2", second: "2", three: "3", third: "3", four: "4", fourth: "4", five: "5", fifth: "5" };
  const YES = ["yes", "yeah", "yep", "yup", "right", "correct", "that's it", "thats it", "sure", "ok", "okay", "please do", "go on"];
  const NO = ["no", "nope", "nah", "wrong", "not that", "again", "different", "other one"];

  function setFreeInput(on) {
    ui.freetext.disabled = !on; ui.send.disabled = !on;
    ui.mic.disabled = !on || !Recognition;
    if (!on) stopListening();
  }
  function keywordDecide(text, options) {
    const t = " " + text.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ") + " ";
    const scores = options.map((o) => {
      const hints = [...(o.hints || []), String(o.label || "").toLowerCase(), String(o.value || "").toLowerCase()].filter(Boolean);
      let s = 0;
      for (const h of new Set(hints)) {
        const i = t.indexOf(" " + h + " ");
        if (i < 0) continue;
        s += NEG.test(t.slice(Math.max(0, i - 16), i + 1)) ? -1 : 1;
      }
      return s;
    });
    const best = Math.max(...scores);
    const winners = scores.filter((s) => s === best).length;
    if (best <= 0 || winners > 1) {
      // a lone negation against a two-way choice means the other one
      if (options.length === 2) {
        const neg = scores.findIndex((s) => s < 0);
        if (neg >= 0 && scores[1 - neg] === 0) return { picked: options[1 - neg].value, confidence: 0.6 };
      }
      return { picked: "unclear", confidence: 0 };
    }
    const idx = scores.indexOf(best);
    return { picked: options[idx].value, confidence: best >= 2 ? 0.85 : 0.72 };
  }
  async function freeInput(raw, via) {
    const text = String(raw || "").trim().slice(0, 300);
    const p = call && call.prompt;
    if (!text || !p || !p.free) return;
    ui.heard.textContent = `Heard: “${text}”`;
    const low = text.toLowerCase();
    if ((C.safety.trigger_words || []).some((w) => low.includes(w))) { log("safety_triggered", { via: "trigger_word", prompt_id: p.id }); return safety("trigger_word"); }

    // a number said or typed goes straight to that key
    // number words only count when they're clearly a choice ("two", "option two", "the first one")
    const words = low.replace(/[^\w\s]/g, " ").trim().split(/\s+/);
    const numMatch = low.match(/\b([0-9])\b/) ||
      (words.length <= 3 && low.match(/\b(one|two|three|four|five|first|second|third|fourth|fifth)\b/)) ||
      low.match(/\b(?:number|option|press|choice)\s+(one|two|three|four|five)\b/);
    if (numMatch) {
      const key = NUM[numMatch[1]] || numMatch[1];
      const opt = p.options.find((o) => o.key === key);
      if (opt) { log("decision", { prompt_id: p.id, heard: text, picked: opt.value ?? opt.key, confidence: 1, engine: "number", via }); return choose(opt, via); }
    }

    const opts = p.options.filter((o) => !o.locked).map((o) => ({ ...o, value: String(o.value ?? o.key),
      hints: o.hints || (p.id === "confirm" ? (o.key === "1" ? YES : NO) : []) }));
    let result = null, engine = "keywords";
    if (settings.decide === "ai" && cfg.ai) {
      ui.heard.textContent = `Heard: “${text}” · thinking…`;
      try {
        const r = await postJSON("/api/decide", { prompt_id: p.id, question: p.text, options: opts.map((o) => ({ value: o.value, label: o.label })), heard: text }, 6000);
        if (r.ok) { result = await r.json(); engine = "gemini"; }
      } catch { /* fall back to keywords */ }
    }
    if (call?.prompt !== p) return; // the visitor moved on while we waited
    if (!result) result = keywordDecide(text, opts);
    const picked = opts.find((o) => o.value === result.picked);
    ui.heard.textContent = `Heard: “${text}”` + (picked ? ` → ${picked.label}` : "");
    log("decision", { prompt_id: p.id, allowed: opts.map((o) => o.value), heard: text, picked: result.picked, confidence: result.confidence, engine, via });

    if (!picked) {
      log("not_understood", { prompt_id: p.id, heard: text });
      speak(C.operator.not_understood, "operator", () => armSilence(p));
      return;
    }
    if (result.confidence >= 0.75) return choose(p.options.find((o) => String(o.value ?? o.key) === picked.value), via, { confidence: result.confidence });
    // unsure: confirm before acting
    const original = p;
    ask({
      id: "confirm", speaker: original.speaker, zero: original.zero,
      text: fill(C.operator.confirm_template, { option: picked.label }),
      options: [{ key: "1", label: "Yes, that's right", value: "yes" }, { key: "2", label: "Choose again", value: "no" }],
      onPick: (o) => {
        log("decision_confirmed", { prompt_id: original.id, picked: picked.value, confirmed: o.key === "1" });
        if (o.key === "1") { call.prompt = original; choose(original.options.find((x) => String(x.value ?? x.key) === picked.value), via, { confirmed: true }); }
        else ask(original);
      },
    });
  }
  $("#freeform").addEventListener("submit", (e) => { e.preventDefault(); const v = ui.freetext.value; ui.freetext.value = ""; freeInput(v, "text"); });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function stopListening() { if (rec) { try { rec.stop(); } catch { /* already stopped */ } } }
  ui.mic.addEventListener("click", () => {
    if (!Recognition) return;
    if (rec) return stopListening();
    stopSpeech(); clearSilence();
    rec = new Recognition();
    rec.lang = "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1;
    ui.mic.setAttribute("aria-pressed", "true"); ui.micLabel.textContent = "Listening…";
    rec.onresult = (e) => freeInput(e.results[0][0].transcript, "speech");
    rec.onerror = (e) => { ui.heard.textContent = e.error === "not-allowed" ? "Microphone blocked. You can type or press a number." : "Didn't catch that. Try again, type, or press a number."; };
    rec.onend = () => { rec = null; ui.mic.setAttribute("aria-pressed", "false"); ui.micLabel.textContent = "Speak"; };
    rec.start();
  });

  // ---------- call lifecycle ----------
  function updateCallInfo() {
    if (!call || !call.session) { ui.callinfo.textContent = ""; return; }
    const p = call.profile;
    const cls = p.class_id ? C.classes.find((c) => c.id === p.class_id)?.name : null;
    const br = p.branch_id ? branchById(p.branch_id)?.name : null;
    ui.callinfo.textContent = [call.session.wristband_id || "Anonymous", cls, br].filter(Boolean).join(" · ");
  }
  function pickUp() {
    if (offhook) return hangUp();
    offhook = true;
    ui.handset.setAttribute("aria-pressed", "true"); ui.handsetLabel.textContent = "Hang up";
    ui.lamp.className = "lamp on";
    if (!consented) { showConsent(); return; }
    startCall();
  }
  function showConsent() {
    ui.consent.hidden = false;
    $("#agree").focus();
  }
  $("#agree").addEventListener("click", () => { consented = true; ui.consent.hidden = true; startCall(); });
  $("#decline").addEventListener("click", () => { ui.consent.hidden = true; hangUp(); ui.caption.textContent = "No problem. Nothing was logged."; });
  ui.consent.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#decline").click(); });

  function startCall() {
    call = { session: null, profile: freshProfile(), screen: "scan", prompt: null };
    ui.reader.classList.add("armed"); ui.tap.disabled = false;
    ask({
      id: "scan", screen: "scan", text: C.operator.scan_prompt, zero: false, free: false,
      options: [{ key: "#", label: "Tap wristband" }, { key: "*", label: "Continue without scanning" }],
      onPick: (o) => (o.key === "#" ? scan(wristband) : scan(null)),
    });
  }
  async function scan(wb) {
    if (!call || call.session) return;
    ui.reader.classList.remove("armed"); ui.tap.disabled = true;
    if (wb) { const b = document.querySelector(".band"); b.classList.remove("tapped"); void b.offsetWidth; b.classList.add("tapped"); }
    const saved = wb ? await loadProfile(wb) : null;
    if (!call) return;
    call.profile = Object.assign(freshProfile(), saved || {});
    call.session = {
      session_id: "s_" + rid(10), wristband_id: wb, mode: wb ? "wristband" : "anonymous",
      started_at: now(), voice: settings.voice, user_agent: navigator.userAgent.slice(0, 200),
    };
    call.screen = "greeting";
    log("scan", { mode: call.session.mode, returning: !!saved });
    flush();
    const greet = !wb ? C.operator.greeting_anonymous : saved ? C.operator.greeting_returning : C.operator.greeting_new;
    menu(greet + " " + C.operator.controls_hint);
  }
  function hangUp(reason) {
    stopSpeech(); clearSilence(); stopListening();
    if (call && call.session) {
      const screen = call.screen;
      log("hang_up", { from_prompt: call.prompt?.id || null });
      call.session.ended_at = now();
      call.session.end_reason = reason || (screen === "menu" || screen === "summary" ? "hung_up_menu" : "hung_up_mid");
      flush(true);
    }
    call = null; offhook = false;
    ui.handset.setAttribute("aria-pressed", "false"); ui.handsetLabel.textContent = "Pick up";
    ui.lamp.className = "lamp";
    ui.reader.classList.remove("armed"); ui.tap.disabled = true;
    ui.crt.classList.remove("safety");
    ui.speaker.textContent = "Line idle"; ui.caption.textContent = "Pick up the handset to begin."; ui.sub.textContent = "";
    ui.options.innerHTML = ""; ui.foot.textContent = ""; ui.heard.textContent = "";
    setFreeInput(false); updateCallInfo();
  }
  ui.handset.addEventListener("click", pickUp);
  ui.tap.addEventListener("click", () => { if (call && !call.session) scan(wristband); });
  ui.newband.addEventListener("click", () => { if (call && call.session) return; wristband = newBandId(); store.set("bb_wristband", wristband); showBand(); });
  $("#useband").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#bandinput").value.trim().toUpperCase();
    if (!/^WB-[A-Z0-9]{3,8}$/.test(v) || (call && call.session)) return;
    wristband = v; store.set("bb_wristband", v); showBand(); $("#bandinput").value = "";
  });
  addEventListener("pagehide", () => { if (call && call.session) hangUp("closed_page"); });

  // ---------- Operator menu ----------
  function menu(preface) {
    const m = C.operator.menu;
    ask({
      id: "menu", screen: "menu", speaker: "operator",
      text: (preface ? preface + " " : "") + m.say,
      options: m.options.map((o) => ({ key: o.key, label: o.label, value: o.goes_to, hints: [o.label.toLowerCase(), o.goes_to] })),
      onPick: (o) => ({ quiz: () => quizStart("menu"), quest, helper, echoes, summary }[o.value])(),
    });
  }

  // ---------- class quiz ----------
  function quizStart(then) {
    const p = call.profile;
    if (p.class_id && then === "menu") {
      const cls = classById(p.class_id);
      return ask({
        id: "quiz_again", screen: "quiz", text: `You are already ${cls.name}. Press 1 to keep it, or 2 to take the quiz again.`,
        options: [{ key: "1", label: "Keep my class", value: "keep" }, { key: "2", label: "Take the quiz again", value: "retake" }],
        onPick: (o) => (o.value === "keep" ? menu() : runQuiz(then)),
      });
    }
    runQuiz(then);
  }
  function runQuiz(then) {
    const qs = C.quiz.questions, scores = Object.fromEntries(C.classes.map((c) => [c.id, 0]));
    const next = (i) => {
      if (i >= qs.length) return quizResult(scores, then);
      const q = qs[i];
      ask({
        id: "quiz_" + q.id, screen: "quiz", text: (i === 0 ? C.quiz.intro + " " : "") + q.say, sub: `Question ${i + 1} of ${qs.length}`,
        speakOptions: true, options: q.answers.map((a) => ({ key: a.key, label: a.label, value: a.key })),
        onPick: (o) => {
          const a = q.answers.find((x) => x.key === o.key);
          for (const [cid, pts] of Object.entries(a.points || {})) scores[cid] = (scores[cid] || 0) + pts;
          log("quiz_answer", { question_id: q.id, answer_key: a.key });
          next(i + 1);
        },
      });
    };
    next(0);
  }
  function quizResult(scores, then) {
    const best = Math.max(...Object.values(scores));
    const cid = C.quiz.tie_break_order.find((id) => scores[id] === best);
    const p = call.profile;
    if (p.class_id && p.class_id !== cid) { p.branch_id = null; p.step_index = 0; }
    p.class_id = cid; p.quiz_scores = scores;
    log("class_assigned", { class_id: cid, scores });
    saveProfile();
    const cls = classById(cid);
    ask({
      id: "quiz_result", screen: "quiz", speaker: cls.character,
      text: fill(C.quiz.result_template, { class_name: cls.name, class_description: cls.description }),
      options: [then === "quest" ? { key: "1", label: "Continue to my quest", value: "quest" } : { key: "1", label: "Back to the main menu", value: "menu" }],
      onPick: (o) => (o.value === "quest" ? askNeeds() : menu()),
    });
  }

  // ---------- quests ----------
  const classById = (id) => C.classes.find((c) => c.id === id);
  const branchById = (id) => C.branches.find((b) => b.id === id);
  function quest() {
    const p = call.profile;
    if (!p.class_id) {
      return ask({ id: "quiz_first", screen: "quest", text: C.operator.quiz_first,
        options: [{ key: "1", label: "Start the quiz", value: "start" }], onPick: () => runQuiz("quest") });
    }
    if (p.branch_id) {
      const b = branchById(p.branch_id);
      return stepPrompt(fill(C.quest_flow.resume, { branch_name: b.name, step_number: p.step_index + 1, step_total: b.steps.length }) + " ");
    }
    askNeeds();
  }
  function askNeeds() {
    const qs = C.needs.questions, needs = {};
    const next = (i) => {
      if (i >= qs.length) { call.profile.needs = needs; return route("routing"); }
      const q = qs[i];
      ask({
        id: "need_" + q.id, screen: "needs", text: (i === 0 ? C.needs.intro + " " : "") + q.say,
        options: q.options.map((o) => ({ key: o.key, label: o.label, value: o.value, hints: o.hints })),
        onPick: (o, via) => { needs[q.id] = o.value; log("need_answer", { need_id: q.id, value: o.value, input: via }); next(i + 1); },
      });
    };
    next(0);
  }
  function scoreBranches(classId, needs, exclude = []) {
    const w = C.routing.weights;
    return C.branches.filter((b) => b.class === classId && !exclude.includes(b.id))
      .map((b) => ({ b, score: Object.keys(w).reduce((s, k) => s + (b.tags[k] === needs[k] ? w[k] : 0), 0) }))
      .sort((x, y) => y.score - x.score);
  }
  function route(reason) {
    const p = call.profile;
    const ranked = scoreBranches(p.class_id, p.needs, p.completed);
    if (!ranked.length) return ask({ id: "all_done", screen: "quest", text: C.quest_flow.all_done, options: [{ key: "1", label: "Back to the main menu" }], onPick: () => menu() });
    assign(ranked[0].b, reason, Object.fromEntries(ranked.map((r) => [r.b.id, r.score])));
  }
  function assign(b, reason, scores) {
    const p = call.profile;
    p.branch_id = b.id; p.step_index = 0; p.step_started_at = Date.now();
    log("branch_assigned", { branch_id: b.id, scores, reason, needs: p.needs });
    saveProfile();
    stepPrompt(b.intro + " ");
  }
  function stepPrompt(preface = "") {
    const p = call.profile, b = branchById(p.branch_id), step = b.steps[p.step_index];
    if (!p.step_started_at) p.step_started_at = Date.now();
    ask({
      id: "step_" + step.id, screen: "quest", speaker: classById(b.class).character,
      text: preface + step.say + " " + C.quest_flow.step_prompt,
      sub: `${b.name} · step ${p.step_index + 1} of ${b.steps.length} · ${step.where}`,
      options: [
        { key: "1", label: "I've done this step", value: "done", hints: ["done", "did it", "finished", "found it", "complete", "next"] },
        { key: "2", label: "Hear it again", value: "again", hints: ["again", "repeat", "what", "pardon", "sorry"] },
        { key: "3", label: "I need help", value: "help", hints: ["help", "stuck", "lost", "confused"] },
      ],
      onPick: (o) => {
        if (o.value === "again") { log("repeat", { prompt_id: "step_" + step.id }); return stepPrompt(); }
        if (o.value === "help") return helper();
        stepDone(b, step);
      },
    });
  }
  function stepDone(b, step) {
    const p = call.profile;
    const seconds = p.step_started_at ? Math.round((Date.now() - p.step_started_at) / 1000) : null;
    log("step_done", { branch_id: b.id, step_id: step.id, step_number: p.step_index + 1, seconds_on_step: seconds });
    if (!p.steps_done.includes(step.id)) p.steps_done.push(step.id);
    p.step_index += 1; p.step_started_at = Date.now();
    if (p.step_index >= b.steps.length) {
      p.completed.push(b.id); p.branch_id = null; p.step_index = 0; p.step_started_at = null;
      log("quest_complete", { branch_id: b.id });
      saveProfile();
      return ask({ id: "quest_complete", screen: "quest", speaker: classById(b.class).character, text: b.complete,
        options: [{ key: "1", label: "Back to the main menu" }, { key: "2", label: "Print my journey", value: "print" }],
        onPick: (o) => (o.key === "2" ? summary() : menu()) });
    }
    saveProfile();
    stepPrompt(fill(C.quest_flow.next_step, { step_say: "" }).trim() + " ");
  }

  // ---------- helper ----------
  function helper() {
    const h = C.helper;
    ask({
      id: "helper", screen: "helper", text: h.intro,
      options: h.topics.map((t) => ({ key: t.key, label: t.label, value: t.id })),
      onPick: (o) => {
        const t = h.topics.find((x) => x.id === o.value);
        topic(t);
        if (t.action === "say_next_step") return whatsNext();
        if (t.action === "swap_quieter") return swapQuieter();
        if (t.goes_to === "helper_more") return subMenu("helper_more", h.more_intro, h.more_topics);
      },
    });
  }
  function topic(t) { log("helper_topic", { topic_id: t.id }); call.profile.helper_topics.push(t.id); saveProfile(); }
  function subMenu(id, intro, topics) {
    ask({
      id, screen: "helper", text: intro, options: topics.map((t) => ({ key: t.key, label: t.label, value: t.id })),
      onPick: (o) => {
        const t = topics.find((x) => x.id === o.value);
        topic(t);
        if (t.action === "safety") { log("safety_triggered", { via: "menu" }); return safety("menu"); }
        if (t.goes_to === "helper_other") return subMenu("helper_other", C.helper.other_intro, C.helper.other_topics);
        afterAnswer("help_" + t.id, t.say);
      },
    });
  }
  function afterAnswer(id, text, speaker) {
    const active = !!call.profile.branch_id;
    ask({ id, screen: "helper", speaker, text,
      options: [{ key: "1", label: active ? "Back to my quest" : "Back to the main menu", value: active ? "quest" : "menu" }, { key: "2", label: "Something else", value: "helper" }],
      onPick: (o) => (o.value === "quest" ? stepPrompt() : o.value === "helper" ? helper() : menu()) });
  }
  function whatsNext() {
    const p = call.profile;
    if (!p.branch_id) return afterAnswer("help_no_quest", C.helper.no_quest);
    stepPrompt();
  }
  function swapQuieter() {
    const p = call.profile;
    if (!p.branch_id) return afterAnswer("help_no_quest", C.helper.no_quest);
    const ranked = scoreBranches(p.class_id, p.needs, [...p.completed, p.branch_id]);
    const target = ranked.find((r) => r.b.tags.energy === "quiet") || ranked[0];
    if (!target) return afterAnswer("swap_none", C.helper.swap_none);
    const from = p.branch_id;
    p.swaps += 1;
    log("swap_quieter", { from_branch: from, to_branch: target.b.id, at_step: p.step_index + 1 });
    p.branch_id = target.b.id; p.step_index = 0; p.step_started_at = Date.now();
    log("branch_assigned", { branch_id: target.b.id, reason: "swap_quieter", scores: Object.fromEntries(ranked.map((r) => [r.b.id, r.score])) });
    saveProfile();
    stepPrompt(fill(C.helper.swap_done, { branch_name: target.b.name }) + " " + target.b.intro + " ");
  }
  function safety(via) {
    ask({ id: "safety", screen: "safety", safety: true, text: C.safety.message,
      options: [{ key: "1", label: "Hear that again", value: "again" }, { key: "2", label: "Back to the main menu", value: "menu" }],
      onPick: (o) => (o.value === "again" ? safety(via) : menu()) });
  }

  // ---------- echoes ----------
  function echoUnlocked(e) {
    const p = call.profile;
    return { always: true, after_quiz: !!p.class_id, after_first_step: p.steps_done.length > 0, after_quest_complete: p.completed.length > 0 }[e.unlock] ?? true;
  }
  function echoes() {
    const items = C.echoes.items;
    ask({
      id: "echoes", screen: "echoes", text: C.echoes.intro, speakOptions: true,
      options: items.map((e) => ({ key: e.key, label: e.name, value: e.id, locked: !echoUnlocked(e) })),
      onPick: (o) => {
        const e = items.find((x) => x.id === o.value);
        if (!echoUnlocked(e)) { log("echo_locked", { echo_id: e.id }); return afterEcho("echo_locked", C.echoes.locked, "operator"); }
        const p = call.profile;
        if (!p.echoes.includes(e.id)) p.echoes.push(e.id);
        saveProfile();
        log("echo_played", { echo_id: e.id });
        afterEcho("echo_" + e.id, e.say, "echo");
      },
    });
  }
  function afterEcho(id, text, speaker) {
    ask({ id, screen: "echoes", speaker, text,
      options: [{ key: "1", label: "Another echo", value: "more" }, { key: "2", label: "Back to the main menu", value: "menu" }],
      onPick: (o) => (o.value === "more" ? echoes() : menu()) });
  }

  // ---------- printed summary ----------
  function facts() {
    const p = call.profile;
    const cls = p.class_id ? classById(p.class_id) : null;
    const b = p.branch_id ? branchById(p.branch_id) : null;
    const step = b ? b.steps[p.step_index] : null;
    return {
      class_name: cls ? cls.name : "not chosen yet",
      class_description: cls ? cls.description : "",
      branch_name: b ? b.name : (p.completed.length ? branchById(p.completed.at(-1)).name : "no quest yet"),
      steps_done: p.steps_done.length,
      step_total: b ? b.steps.length : "",
      quests_completed: p.completed.map((id) => branchById(id).name),
      echoes_heard: p.echoes.map((id) => C.echoes.items.find((e) => e.id === id)?.name).filter(Boolean),
      next_step: step ? `${step.say} (${step.where})` : p.class_id ? "Call the booth and press 2 for a new quest." : "Call the booth and press 1 to find your class.",
      helper_topics: [...new Set(p.helper_topics)],
      swapped_quieter: p.swaps,
      anonymous: !call.session.wristband_id,
    };
  }
  async function summary() {
    call.screen = "summary";
    ask({ id: "printing", screen: "summary", text: C.operator.printing, options: [], free: false });
    const f = facts();
    let text = "", engine = "template";
    if (settings.summary === "ai" && cfg.ai) {
      try {
        const r = await postJSON("/api/summary", { facts: f }, 16000);
        if (r.ok) { text = (await r.json()).text; engine = "gemini"; }
      } catch { /* use the template */ }
    }
    if (!call) return;
    if (!text) text = fill(C.summary.template, { ...f, echoes_heard: f.echoes_heard.join(", ") || "none yet" });
    printReceipt(text, f);
    log("summary_printed", { engine });
    ask({ id: "printed", screen: "summary", text: "Your slip is in the printer tray.",
      options: [{ key: "1", label: "Back to the main menu" }], onPick: () => menu() });
  }
  function printReceipt(text, f) {
    const s = C.summary, when = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    ui.receiptArea.innerHTML = `<div class="receipt" role="document" aria-label="Printed journey summary">
      <h3>${esc(s.header)}</h3><p class="c">${esc(s.subheader)}</p><p class="c">${esc(when)} · ${esc(call.session.wristband_id || "ANONYMOUS")}</p>
      <hr><p>${esc(text)}</p><hr>
      <dl><dt>Class</dt><dd>${esc(f.class_name)}</dd><dt>Quest</dt><dd>${esc(f.branch_name)}</dd>
      <dt>Steps done</dt><dd>${esc(f.steps_done)}</dd><dt>Echoes</dt><dd>${esc(f.echoes_heard.join(", ") || "none yet")}</dd></dl>
      <hr><p class="c">${esc(s.footer)}</p></div>
      <div class="receipt-actions"><button type="button" class="btn" id="tear">Tear off</button></div>`;
    $("#tear").addEventListener("click", () => { ui.receiptArea.innerHTML = `<p class="hint">Press 5 at the main menu to print your journey so far.</p>`; });
  }

  // ---------- settings ----------
  function applySettings() {
    store.set("bb_settings", settings);
    document.body.classList.toggle("large", settings.size === "large");
    for (const name of ["voice", "decide", "summary", "size"]) {
      const el = document.querySelector(`input[name=${name}][value=${settings[name]}]`);
      if (el) el.checked = true;
    }
  }
  document.querySelectorAll(".settings input[type=radio]").forEach((el) => el.addEventListener("change", () => {
    settings[el.name] = el.value; applySettings();
    if (el.name === "voice") stopSpeech();
  }));

  // ---------- boot ----------
  async function boot() {
    showBand();
    try { C = await (await fetch("/content/content.json", { cache: "no-store" })).json(); }
    catch { ui.caption.textContent = "The content file couldn't be loaded. Check content.json is valid JSON."; ui.handset.disabled = true; return; }
    $("#consent-h").textContent = C.consent.title;
    $("#consent-body").innerHTML = C.consent.body.map((l) => `<li>${esc(l)}</li>`).join("");
    $("#agree").textContent = C.consent.agree; $("#decline").textContent = C.consent.decline;
    try { cfg = await (await fetch("/api/config", { cache: "no-store" })).json(); } catch { /* static preview: free fallbacks only */ }
    $("#voice-gemini").disabled = !cfg.tts; $("#decide-ai").disabled = !cfg.ai; $("#summary-ai").disabled = !cfg.ai;
    if (!cfg.tts && settings.voice === "gemini") settings.voice = "browser";
    if (!cfg.ai) { settings.decide = "keywords"; settings.summary = "template"; }
    applySettings();
    ui.services.textContent = `Gemini: ${cfg.ai ? "on" : "off"} · Gemini voices: ${cfg.tts ? "on" : "off"} · Logging: ${cfg.storage ? "on" : "off"} · Speech input: ${Recognition ? "available" : "not in this browser (use Chrome)"}`;
    ui.lamp.className = "lamp ringing";
    setTimeout(() => { if (!offhook) ui.lamp.className = "lamp"; }, 4000);
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
  }
  boot();
}
