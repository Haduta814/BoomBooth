/* BoomBooth panel: reads every session and event and turns them into pain-point signals. */
{
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const secs = (s) => (s == null ? "–" : s < 90 ? Math.round(s) + " s" : (s / 60).toFixed(1) + " min");
  let pass = "";
  try { pass = sessionStorage.getItem("bb_pass") || ""; } catch { /* none */ }
  let data = null, timer = null;

  async function load() {
    $("#status").textContent = "Loading…";
    const r = await fetch("/api/panel", { headers: { "x-panel-passcode": pass }, cache: "no-store" });
    if (r.status === 401) throw new Error("Wrong passcode.");
    if (r.status === 503) { const j = await r.json().catch(() => ({})); throw new Error(j.error === "no_passcode_set" ? "No PANEL_PASSCODE is set in Vercel yet." : "Logging isn't connected yet (check the Supabase settings)."); }
    if (!r.ok) throw new Error("Couldn't load data (" + r.status + ").");
    data = await r.json();
    render();
    $("#status").textContent = `Updated ${new Date().toLocaleTimeString("en-GB")} · Gemini ${data.config.ai ? "on" : "off"} (${data.config.model})`;
  }

  $("#loginform").addEventListener("submit", async (e) => {
    e.preventDefault();
    pass = $("#pass").value;
    try {
      await load();
      try { sessionStorage.setItem("bb_pass", pass); } catch { /* none */ }
      $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    } catch (err) { $("#loginstatus").textContent = err.message; }
  });
  $("#refresh").addEventListener("click", () => load().catch((e) => ($("#status").textContent = e.message)));
  $("#auto").addEventListener("change", (e) => {
    clearInterval(timer);
    if (e.target.checked) timer = setInterval(() => load().catch((er) => ($("#status").textContent = er.message)), 15000);
  });

  function table(el, head, rows, empty = "Nothing logged yet.") {
    if (!rows.length) { el.innerHTML = `<tbody><tr><td>${esc(empty)}</td></tr></tbody>`; return; }
    el.innerHTML = `<thead><tr>${head.map((h) => `<th class="${h.n ? "n" : ""}">${esc(h.t)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.join("")}</tr>`).join("")}</tbody>`;
  }
  const td = (v, n) => `<td class="${n ? "n" : ""}">${esc(v)}</td>`;
  const bar = (v, max) => `<td class="barcell"><div class="bar" role="img" aria-label="${Math.round((v || 0) * 100)}%"><i style="width:${max ? Math.min(100, (v / max) * 100) : 0}%"></i></div></td>`;

  function render() {
    const { sessions, events } = data;
    const by = (t) => events.filter((e) => e.type === t);
    const d = (e) => e.data || {};

    // ---- KPIs ----
    const wb = sessions.filter((s) => s.mode === "wristband");
    const durations = sessions.filter((s) => s.ended_at && s.started_at).map((s) => (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000);
    const assigned = by("branch_assigned").filter((e) => d(e).reason === "routing").length;
    const kpis = [
      [sessions.length, "sessions"],
      [new Set(wb.map((s) => s.wristband_id)).size, "wristbands"],
      [pct(sessions.length - wb.length, sessions.length), "continued without scanning"],
      [assigned, "quests given"],
      [by("step_done").length, "quest steps done"],
      [by("quest_complete").length, "quests completed"],
      [secs(median(durations)), "median call length"],
      [pct(sessions.filter((s) => s.end_reason === "hung_up_mid").length, sessions.length), "hung up mid-flow"],
      [by("safety_triggered").length, "safety messages played"],
    ];
    $("#kpis").innerHTML = kpis.map(([v, l]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

    // ---- prompts ----
    const P = {};
    const bump = (id, k, n = 1) => { if (!id) return; P[id] = P[id] || { shown: 0, repeat: 0, silence: 0, nu: 0, back: 0, hang: 0, secs: [] }; P[id][k] += n; };
    for (const e of events) {
      const x = d(e);
      if (e.type === "prompt_shown") bump(x.prompt_id, "shown");
      if (e.type === "repeat") bump(x.prompt_id, "repeat");
      if (e.type === "silence") bump(x.prompt_id, "silence");
      if (e.type === "not_understood") bump(x.prompt_id, "nu");
      if (e.type === "back_to_operator") bump(x.from_prompt, "back");
      if (e.type === "hang_up" && x.from_prompt && x.from_prompt !== "menu") bump(x.from_prompt, "hang");
      if (e.type === "choice" && P[x.prompt_id] && Number.isFinite(x.seconds)) P[x.prompt_id].secs.push(x.seconds);
    }
    const prow = Object.entries(P).filter(([, v]) => v.shown).map(([id, v]) => ({ id, ...v, friction: (v.repeat + v.silence + v.nu + v.back + v.hang) / v.shown }))
      .sort((a, b) => b.friction - a.friction).slice(0, 40);
    const maxF = Math.max(0.01, ...prow.map((r) => r.friction));
    table($("#prompts"), [{ t: "Prompt" }, { t: "Friction" }, { t: "Shown", n: 1 }, { t: "Repeats", n: 1 }, { t: "Silences", n: 1 }, { t: "Not understood", n: 1 }, { t: "Back to Operator", n: 1 }, { t: "Hung up here", n: 1 }, { t: "Median time to answer", n: 1 }],
      prow.map((r) => [`<td><code>${esc(r.id)}</code></td>`, bar(r.friction, maxF), td(r.shown, 1), td(r.repeat, 1), td(r.silence, 1), td(r.nu, 1), td(r.back, 1), td(r.hang, 1), td(secs(median(r.secs)), 1)]));

    // ---- steps ----
    const S = {};
    for (const e of events) {
      const x = d(e);
      if (e.type === "prompt_shown" && String(x.prompt_id).startsWith("step_")) { const id = x.prompt_id.slice(5); (S[id] ||= { reached: new Set(), done: 0, help: 0, swap: 0, hang: 0, secs: [] }).reached.add(e.session_id); }
    }
    for (const e of events) {
      const x = d(e);
      const s = (id) => S[id] || (S[id] = { reached: new Set(), done: 0, help: 0, swap: 0, hang: 0, secs: [] });
      if (e.type === "step_done") { s(x.step_id).done++; if (Number.isFinite(x.seconds_on_step)) s(x.step_id).secs.push(x.seconds_on_step); }
      if (e.type === "choice" && String(x.prompt_id).startsWith("step_") && x.value === "help") s(x.prompt_id.slice(5)).help++;
      if (e.type === "hang_up" && String(x.from_prompt).startsWith("step_")) s(x.from_prompt.slice(5)).hang++;
    }
    for (const e of by("swap_quieter")) { const x = d(e); const id = `${x.from_branch}_s${x.at_step}`; (S[id] ||= { reached: new Set(), done: 0, help: 0, swap: 0, hang: 0, secs: [] }).swap++; }
    const srow = Object.entries(S).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
    table($("#steps"), [{ t: "Step" }, { t: "Sessions reaching it", n: 1 }, { t: "Done", n: 1 }, { t: "Asked for help", n: 1 }, { t: "Swapped quieter", n: 1 }, { t: "Hung up here", n: 1 }, { t: "Median time on step", n: 1 }],
      srow.map(([id, v]) => [`<td><code>${esc(id)}</code></td>`, td(v.reached.size, 1), td(v.done, 1), td(v.help, 1), td(v.swap, 1), td(v.hang, 1), td(secs(median(v.secs)), 1)]));

    // ---- helper ----
    const H = {};
    for (const e of by("helper_topic")) H[d(e).topic_id] = (H[d(e).topic_id] || 0) + 1;
    const hrow = Object.entries(H).sort((a, b) => b[1] - a[1]);
    const maxH = Math.max(1, ...hrow.map((r) => r[1]));
    table($("#helper"), [{ t: "Topic" }, { t: "" }, { t: "Times", n: 1 }], hrow.map(([k, v]) => [`<td><code>${esc(k)}</code></td>`, bar(v, maxH), td(v, 1)]));

    // ---- routing ----
    const R = [];
    const count = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
    for (const [k, v] of Object.entries(count(by("class_assigned").map((e) => d(e).class_id)))) R.push(["Class", k, v]);
    for (const [k, v] of Object.entries(count(by("need_answer").map((e) => `${d(e).need_id}: ${d(e).value}`)))) R.push(["Need", k, v]);
    for (const [k, v] of Object.entries(count(by("branch_assigned").map((e) => `${d(e).branch_id} (${d(e).reason})`)))) R.push(["Branch", k, v]);
    table($("#routing"), [{ t: "Kind" }, { t: "Value" }, { t: "Count", n: 1 }], R.map((r) => [td(r[0]), `<td><code>${esc(r[1])}</code></td>`, td(r[2], 1)]));

    // ---- decisions ----
    const dec = by("decision").slice().reverse();
    const conf = by("decision_confirmed");
    const low = dec.filter((e) => (d(e).confidence ?? 0) < 0.75);
    const engines = count(dec.map((e) => d(e).engine));
    $("#decnote").textContent = `${dec.length} spoken or typed answers · ${Object.entries(engines).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} · ${low.length} below 0.75 confidence · ${conf.filter((e) => !d(e).confirmed).length} corrected by the visitor`;
    table($("#decisions"), [{ t: "When" }, { t: "Prompt" }, { t: "Heard" }, { t: "Picked" }, { t: "Confidence", n: 1 }, { t: "Engine" }],
      dec.slice(0, 100).map((e) => { const x = d(e); return [td(new Date(e.at).toLocaleTimeString("en-GB")), `<td><code>${esc(x.prompt_id)}</code></td>`, td(x.heard), td(x.picked), td(x.confidence, 1), `<td><span class="tag">${esc(x.engine)}</span></td>`]; }));

    // ---- sessions ----
    const evCount = count(events.map((e) => e.session_id));
    table($("#sessions"), [{ t: "Started" }, { t: "Wristband" }, { t: "Length", n: 1 }, { t: "Ended" }, { t: "Events", n: 1 }, { t: "Voice" }],
      sessions.slice(0, 200).map((s) => [td(s.started_at ? new Date(s.started_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "–"),
        `<td><code>${esc(s.wristband_id || "anonymous")}</code></td>`,
        td(s.ended_at ? secs((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000) : "in progress", 1), td(s.end_reason || "–"), td(evCount[s.session_id] || 0, 1), td(s.voice || "–")]));
  }

  // ---- exports ----
  function csv(rows, cols) {
    const cell = (v) => { const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  $("#csv-events").addEventListener("click", () => data && download(`boombooth-events-${stamp()}.csv`, csv(data.events, ["at", "session_id", "wristband_id", "screen", "type", "data"])));
  $("#csv-sessions").addEventListener("click", () => data && download(`boombooth-sessions-${stamp()}.csv`, csv(data.sessions, ["session_id", "wristband_id", "mode", "started_at", "ended_at", "end_reason", "voice", "user_agent"])));

  $("#clearform").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#confirmclear").value !== "DELETE") { $("#clearstatus").textContent = "Type DELETE (in capitals) to confirm."; return; }
    $("#clearstatus").textContent = "Deleting…";
    const r = await fetch("/api/panel", { method: "POST", headers: { "Content-Type": "application/json", "x-panel-passcode": pass }, body: JSON.stringify({ action: "clear", confirm: "DELETE" }) });
    $("#clearstatus").textContent = r.ok ? "All test data deleted." : "Couldn't delete (" + r.status + ").";
    $("#confirmclear").value = "";
    if (r.ok) load().catch(() => {});
  });

  if (pass) load().then(() => { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); }).catch(() => {});
}
