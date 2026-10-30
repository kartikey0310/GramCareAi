const $ = (id) => document.getElementById(id),
  api = async (path, opt = {}) => {
    const r = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opt,
    });
    return r.json();
  };
api("/api/health")
  .then((x) => ($("apiState").textContent = x.ok ? "ONLINE" : "OFFLINE"))
  .catch(() => ($("apiState").textContent = "OFFLINE"));
$("big").onclick = () => document.body.classList.toggle("big");
$("voice").onclick = () => {
  if (speechSynthesis) {
    let u = new SpeechSynthesisUtterance(
      document.querySelector(".hero h1").innerText,
    );
    u.lang = "en-IN";
    speechSynthesis.speak(u);
  }
};
$("check").onclick = async () => {
  let x = await api("/api/vitals", {
    method: "POST",
    body: JSON.stringify({
      hr: +$("hr").value,
      spo2: +$("spo2").value,
      temp: +$("temp").value,
    }),
  });
  $("flag").innerHTML =
    `<span class="chip ${x.flag}">${x.flag}</span> ${x.message}`;
};
async function patients() {
  let ps = await api("/api/patients");
  $("pt").innerHTML = ps
    .map(
      (p) =>
        `<tr><td>${p.id}</td><td>${p.name}</td><td>${p.age}</td><td>${p.village}</td><td>${p.mobile.slice(0, 2)}••••••${p.mobile.slice(-2)}</td><td><span class="chip ${p.flag}">${p.flag}</span></td></tr>`,
    )
    .join("");
}
patients();
$("addPatient").onclick = async () => {
  let x = await api("/api/patients", {
    method: "POST",
    body: JSON.stringify({
      name: $("pn").value,
      age: +$("pa").value,
      village: $("pv").value,
      mobile: $("pm").value,
    }),
  });
  $("pmsg").textContent = x.error || `Saved ${x.id}`;
  if (x.ok) patients();
};
$("sos").onclick = async () => {
  let x = await api("/api/emergency", {
    method: "POST",
    body: JSON.stringify({
      name: $("en").value || "Unknown patient",
      problem: $("ep").value,
    }),
  });
  $("estatus").innerHTML =
    `<h3>${x.status}</h3><p>Case ${x.id} · ${x.responder} · Demo ETA ${x.eta_min} min</p>`;
};
let cart = [];
function drawCart() {
  $("cartCount").textContent = cart.length;
  $("total").textContent = cart.reduce((s, m) => s + m.price, 0);
}
api("/api/medicines")
  .then(
    (ms) =>
      ($("meds").innerHTML =
        ms
          .map(
            (m, i) =>
              `<article class="card med"><div>💊</div><h3>${m.name}</h3><p class="note">${m.category}</p><div class="price">₹${m.price}</div><button class="btn ${m.rx ? "danger" : ""}" ${m.rx ? "disabled" : ""} onclick="addMed(${i})">${m.rx ? "🔒 Prescription required" : "Add to cart"}</button></article>`,
          )
          .join("") || ""),
  )
  .then(() => api("/api/medicines").then((ms) => (window._meds = ms)));
window.addMed = (i) => {
  cart.push(window._meds[i]);
  drawCart();
};

/* ---- offline mode, data meter, voice help ---- */
const LS = localStorage,
  fmt = (b) =>
    b < 1024
      ? b + " B"
      : b < 1048576
        ? (b / 1024).toFixed(1) + " KB"
        : (b / 1048576).toFixed(2) + " MB";
let sim = LS.gc_sim === "1";
const online = () => navigator.onLine && !sim;
const swMsg = async (m) => {
  try {
    const r = await navigator.serviceWorker.ready;
    return await new Promise((res) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => res(e.data);
      r.active.postMessage(m, [ch.port2]);
      setTimeout(() => res(null), 8000);
    });
  } catch {
    return null;
  }
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => swMsg({ t: "sim", sim }));
document.documentElement.dataset.theme = LS.gc_theme || "light";
$("theme").onclick = () => {
  const d = document.documentElement;
  d.dataset.theme = d.dataset.theme === "dark" ? "light" : "dark";
  LS.gc_theme = d.dataset.theme;
};
function paintNet() {
  const c = navigator.connection,
    on = online(),
    el = $("net");
  el.className = "net " + (on ? "on" : "off");
  el.textContent = on
    ? "● Online" + (c && c.effectiveType ? " · " + c.effectiveType : "")
    : "● Offline";
  document.body.classList.toggle("off", !on);
}
addEventListener("online", () => {
  paintNet();
  flush();
});
addEventListener("offline", paintNet);
paintNet();
const COL = {
  document: "#087f8c",
  script: "#5141aa",
  style: "#d98a00",
  api: "#d4202c",
  other: "#607985",
};
async function paintStats() {
  const r = await swMsg({ t: "stats" });
  if (!r) return;
  const s = r.stats,
    tot = s.net + s.cache;
  $("mNet").textContent = fmt(s.net);
  $("mNetReq").textContent = s.netReq + " requests over the internet";
  $("mCache").textContent = fmt(s.cache);
  $("mCacheReq").textContent = s.cacheReq + " requests from storage";
  $("mSave").textContent = tot ? Math.round((s.cache / tot) * 100) + "%" : "0%";
  const t = Object.entries(s.types).filter((e) => e[1] > 0),
    sum = t.reduce((a, e) => a + e[1], 0) || 1;
  $("bar").innerHTML = t
    .map(
      ([k, v]) =>
        `<i style="width:${(v / sum) * 100}%;background:${COL[k] || COL.other}"></i>`,
    )
    .join("");
  $("legend").innerHTML = t
    .map(
      ([k, v]) =>
        `<span><u style="background:${COL[k] || COL.other}"></u>${k} ${fmt(v)}</span>`,
    )
    .join("");
  $("ready").textContent =
    r.cached >= 5
      ? "✅ Offline ready: this site now runs without internet."
      : "Saving this site for offline use… stay online for a moment.";
  if (navigator.storage && navigator.storage.estimate)
    navigator.storage
      .estimate()
      .then((e) => ($("mStore").textContent = fmt(e.usage || 0)));
}
paintStats();
setInterval(paintStats, 2500);
$("refresh").onclick = async () => {
  $("ready").textContent = "Updating offline copy…";
  await swMsg({ t: "refresh" });
  paintStats();
};
$("reset").onclick = async () => {
  await swMsg({ t: "reset" });
  paintStats();
};
$("sim").checked = sim;
$("sim").onchange = (e) => {
  sim = e.target.checked;
  LS.gc_sim = sim ? "1" : "0";
  swMsg({ t: "sim", sim });
  paintNet();
  flush();
};
/* intent detection runs on the device, so it works offline */
const RULES = [
  ["Chest pain", /chest|heart|seene|सीने|दिल|हार्ट/i],
  ["Difficulty breathing", /breath|saans|सांस|साँस|दम/i],
  [
    "Accident / injury",
    /accident|bleed|injur|khoon|खून|दुर्घटना|एक्सीडेंट|चोट/i,
  ],
  [
    "Pregnancy emergency",
    /pregnan|labou?r|delivery|prasav|garbh|गर्भ|प्रसव|डिलीवरी/i,
  ],
  ["Unconscious / fainting", /unconscious|faint|behosh|बेहोश/i],
  ["Snake / animal bite", /snake|bite|saanp|सांप|साँप|काट/i],
];
function classify(t) {
  const r = RULES.find((x) => x[1].test(t));
  if (r) return { kind: "ambulance", problem: r[0] };
  if (
    /ambulance|emergency|help|bachao|madad|एम्बुलेंस|एंबुलेंस|बचाओ|मदद|आपात/i.test(
      t,
    )
  )
    return { kind: "ambulance", problem: "General emergency" };
  if (
    /doctor|asha|nurse|fever|bukhar|medicine|dawa|डॉक्टर|आशा|बुखार|दवा|दवाई/i.test(
      t,
    )
  )
    return { kind: "doctor", problem: "Medical help request" };
  return null;
}
const hi = () => $("vl").value === "hi-IN",
  say = (t) => {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(t);
      u.lang = $("vl").value;
      speechSynthesis.speak(u);
    }
  };
let cd;
function handle(t) {
  const c = classify(t),
    box = $("confirm");
  if (!c) {
    $("vmsg").textContent =
      "Not sure what you need. Say “ambulance” or “doctor”, or tap a button.";
    return;
  }
  let n = 5;
  box.hidden = false;
  box.innerHTML = `<b>${c.kind === "ambulance" ? "🚑 Ambulance" : "🩺 Doctor / ASHA"}: ${c.problem}</b><p>Sending in <span id="cd">${n}</span> s</p><div class="actions"><button class="btn danger" id="go">Send now</button><button class="btn alt" id="no">Cancel</button></div>`;
  const fin = (ok) => {
    clearInterval(cd);
    box.hidden = true;
    if (ok) sendSOS({ ...c, transcript: t });
  };
  $("go").onclick = () => fin(1);
  $("no").onclick = () => fin(0);
  clearInterval(cd);
  cd = setInterval(() => {
    n--;
    if (n <= 0) fin(1);
    else $("cd").textContent = n;
  }, 1000);
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$("mic").onclick = () => {
  if (!SR) {
    $("vmsg").textContent =
      "Voice is not supported in this browser. Type below or tap a button.";
    return;
  }
  const r = new SR();
  r.lang = $("vl").value;
  r.interimResults = true;
  r.onstart = () => {
    $("mic").classList.add("on");
    $("vmsg").textContent = "Listening…";
  };
  r.onend = () => $("mic").classList.remove("on");
  r.onresult = (e) => {
    const t = [...e.results].map((x) => x[0].transcript).join(" ");
    $("heard").textContent = "“" + t + "”";
    if (e.results[e.results.length - 1].isFinal) handle(t);
  };
  r.onerror = (e) =>
    ($("vmsg").textContent =
      e.error === "network"
        ? "Voice needs internet in this browser. Tap a button instead: your request is saved and sent when you are back online."
        : e.error === "not-allowed"
          ? "Allow microphone access to speak."
          : "Could not hear you. Try again.");
  r.start();
};
document.querySelectorAll(".chips button").forEach(
  (b) =>
    (b.onclick = () => {
      $("heard").textContent = "“" + b.dataset.t + "”";
      handle(b.dataset.t);
    }),
);
$("typedGo").onclick = () => {
  const t = $("typed").value.trim();
  if (t) {
    $("heard").textContent = "“" + t + "”";
    handle(t);
  }
};
/* help requests: send now, or save on the device and send when online */
const Q = () => JSON.parse(LS.gc_q || "[]"),
  setQ = (a) => {
    LS.gc_q = JSON.stringify(a);
    const i = $("qinfo");
    i.hidden = !a.length;
    i.textContent =
      "⏳ " +
      a.length +
      " request(s) saved on this phone. Will send when internet returns.";
  };
setQ(Q());
const post = (q) =>
  api("/api/emergency", {
    method: "POST",
    body: JSON.stringify({ name: q.name, problem: q.problem }),
  }).then((x) => {
    if (x.error) throw 0;
    return x;
  });
async function sendSOS(q) {
  q.name = $("en").value || "Unknown patient";
  q.ts = Date.now();
  if (online())
    try {
      sent(q, await post(q));
      return;
    } catch {}
  setQ([...Q(), q]);
  say(
    hi()
      ? "इंटरनेट आते ही अनुरोध भेजा जाएगा।"
      : "Saved. It will be sent when internet returns.",
  );
}
async function flush() {
  if (!online()) return;
  for (const q of Q())
    try {
      const x = await post(q);
      setQ(Q().filter((i) => i.ts !== q.ts));
      sent(q, x);
    } catch {
      break;
    }
}
setInterval(flush, 15000);
flush();
function sent(q, x) {
  const el = $("track"),
    tot = x.eta_min;
  let left = tot;
  el.hidden = false;
  clearInterval(sent.t);
  const draw = () => {
    el.innerHTML = `<b>✅ Request sent · ${x.id}</b><p>${q.problem}: ${left > 0 ? "help arriving in about " + left + " min (demo)" : "help has arrived (demo)"}</p><div class="road"><span style="left:${((tot - left) / tot) * 100}%">${q.kind === "ambulance" ? "🚑" : "🩺"}</span><em>🏠</em></div>`;
  };
  draw();
  sent.t = setInterval(() => {
    left--;
    draw();
    if (left <= 0) clearInterval(sent.t);
  }, 1500);
  el.scrollIntoView({ block: "center" });
  say(
    hi()
      ? "आपका अनुरोध भेज दिया गया है। मदद रास्ते में है।"
      : "Request sent. Help is on the way.",
  );
}
$("sos").onclick = () => sendSOS({ kind: "ambulance", problem: $("ep").value });

/* ---- v3: live ECG, toasts, search, motion ---- */
const toast = (m) => {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = m;
  $("toasts").append(t);
  setTimeout(() => t.remove(), 2600);
};
addEventListener("online", () => toast("Back online"));
addEventListener("offline", () =>
  toast("You are offline. Saved data still works."),
);
const _sim = $("sim").onchange;
$("sim").onchange = (e) => {
  _sim(e);
  toast(e.target.checked ? "Demo: network off" : "Demo: network on");
};
addEventListener(
  "scroll",
  () => {
    $("prog").style.width =
      (scrollY / (document.body.scrollHeight - innerHeight)) * 100 + "%";
  },
  { passive: true },
);
document.addEventListener("pointermove", (e) => {
  const c = e.target.closest && e.target.closest(".card");
  if (c) {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--x", e.clientX - r.left + "px");
    c.style.setProperty("--y", e.clientY - r.top + "px");
  }
});
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((x) => {
        if (x.isIntersecting) {
          x.target.classList.add("in");
          io.unobserve(x.target);
        }
      }),
    { threshold: 0.08 },
  );
  document.querySelectorAll("main>section:not(.hero)").forEach((s) => {
    s.classList.add("rv");
    io.observe(s);
  });
}
addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() === "v" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)
  )
    $("mic").click();
});
$("ms").oninput = (e) =>
  document
    .querySelectorAll("#meds .med")
    .forEach(
      (c) =>
        (c.style.display = c.textContent
          .toLowerCase()
          .includes(e.target.value.toLowerCase())
          ? ""
          : "none"),
    );
$("ps").oninput = (e) =>
  document
    .querySelectorAll("#pt tr")
    .forEach(
      (r) =>
        (r.style.display = r.textContent
          .toLowerCase()
          .includes(e.target.value.toLowerCase())
          ? ""
          : "none"),
    );
$("meds").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && !b.disabled)
    toast(
      "Added to cart: " + b.closest(".med").querySelector("h3").textContent,
    );
});
$("addPatient").addEventListener("click", () =>
  setTimeout(() => toast($("pmsg").textContent || "Done"), 700),
);
const mt = ["mNet", "mCache", "mSave"];
let last = {};
setInterval(
  () =>
    mt.forEach((k) => {
      const el = $(k);
      if (last[k] !== undefined && last[k] !== el.textContent) {
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
      last[k] = el.textContent;
    }),
  1000,
);
/* vitals: on-device check mirrors the C rules, so it works offline */
const edge = (h, s, t) =>
  h < 30 || h > 220 || s < 50 || s > 100 || t < 30 || t > 45
    ? "INVALID"
    : s < 90 || h > 130 || h < 45 || t >= 39.5
      ? "URGENT"
      : s < 94 || h > 100 || h < 55 || t >= 38
        ? "REVIEW"
        : "NORMAL";
let bpm = 78,
  ecgCol = "#0aa7b8";
$("check").onclick = async () => {
  const h = +$("hr").value,
    s = +$("spo2").value,
    t = +$("temp").value;
  let x;
  try {
    x = await api("/api/vitals", {
      method: "POST",
      body: JSON.stringify({ hr: h, spo2: s, temp: t }),
    });
    if (!x.flag) throw 0;
  } catch {
    const f = edge(h, s, t);
    x = {
      flag: f,
      message:
        (f === "INVALID"
          ? "Re-check the measurement"
          : "Attention flag only, not a diagnosis") +
        " (checked on this device)",
    };
  }
  $("flag").innerHTML =
    `<span class="chip ${x.flag}">${x.flag}</span> ${x.message}`;
  bpm = h >= 30 && h <= 220 ? h : 78;
  $("bpm").textContent = bpm;
  ecgCol =
    x.flag === "URGENT"
      ? "#d4202c"
      : x.flag === "REVIEW"
        ? "#d98a00"
        : "#0aa7b8";
};
$("hr").oninput = () => {
  const h = +$("hr").value;
  if (h >= 30 && h <= 220) {
    bpm = h;
    $("bpm").textContent = h;
  }
};
const beat = (t) =>
  t < 0.1
    ? Math.sin((t / 0.1) * Math.PI) * 0.12
    : t > 0.16 && t < 0.2
      ? -0.1 * Math.sin(((t - 0.16) / 0.04) * Math.PI)
      : t >= 0.2 && t < 0.26
        ? Math.sin(((t - 0.2) / 0.06) * Math.PI)
        : t >= 0.26 && t < 0.31
          ? -0.25 * Math.sin(((t - 0.26) / 0.05) * Math.PI)
          : t > 0.45 && t < 0.62
            ? Math.sin(((t - 0.45) / 0.17) * Math.PI) * 0.2
            : 0;
const cv = $("ecg"),
  cx = cv.getContext("2d");
let ph = 0,
  buf = [],
  lt = 0;
function ecg(ts) {
  const w = (cv.width = cv.clientWidth),
    h = cv.height,
    dt = Math.min((ts - (lt || ts)) / 1000, 0.1);
  lt = ts;
  ph += (dt * bpm) / 60;
  buf.push(beat(ph % 1));
  while (buf.length > w / 2) buf.shift();
  cx.strokeStyle = ecgCol;
  cx.lineWidth = 2.2;
  cx.lineJoin = "round";
  cx.beginPath();
  buf.forEach((v, i) => {
    const x = w - (buf.length - i) * 2,
      y = h * 0.7 - v * h * 0.6;
    i ? cx.lineTo(x, y) : cx.moveTo(x, y);
  });
  cx.stroke();
  requestAnimationFrame(ecg);
}
requestAnimationFrame(ecg);
let liveT;
$("live").onclick = () => {
  if (liveT) {
    clearInterval(liveT);
    liveT = 0;
    $("live").textContent = "▶ Live sensor demo";
    return;
  }
  $("live").textContent = "⏹ Stop demo";
  const tick = () => {
    const bad = Math.random() < 0.25;
    $("hr").value = Math.round(
      bad ? 105 + Math.random() * 40 : 62 + Math.random() * 30,
    );
    $("spo2").value = Math.round(
      bad ? 88 + Math.random() * 6 : 95 + Math.random() * 4,
    );
    $("temp").value = (36.4 + Math.random() * (bad ? 2.6 : 0.9)).toFixed(1);
    $("check").click();
  };
  tick();
  liveT = setInterval(tick, 2500);
};

/* ---- AI Assistant (Gemma 4 via /api/gemma) ----
   Requires internet; never stores messages or keys locally. ---------------- */
const AI_MAX_LEN = 2000;
const AI_TIMEOUT_MS = 30000;
let aiSending = false;

function aiSetLoading(loading) {
  aiSending = loading;
  const btn = $("aiSend");
  const textarea = $("aiMsg");
  const loader = $("aiLoading");
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? "Thinking…" : "Ask AI";
  }
  if (textarea) textarea.disabled = loading;
  if (loader) loader.hidden = !loading;
}

function aiCounter() {
  const ta = $("aiMsg");
  const c = $("aiCounter");
  if (!ta || !c) return;
  const len = ta.value.length;
  c.textContent = len + " / " + AI_MAX_LEN;
  c.style.color = len > AI_MAX_LEN ? "#8b4513" : "var(--mut)";
}

if ($("aiMsg")) {
  $("aiMsg").addEventListener("input", aiCounter);
  aiCounter();
}

if ($("aiSend")) {
  $("aiSend").onclick = async () => {
    if (aiSending) return;
    const ta = $("aiMsg");
    const msg = (ta && ta.value) ? ta.value.trim() : "";
    if (!msg) {
      ta && ta.focus();
      return;
    }
    if (msg.length > AI_MAX_LEN) {
      const errEl = $("aiError");
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = "Message too long (max 2000 characters).";
      }
      return;
    }

    aiSetLoading(true);
    const respEl = $("aiResponse");
    const errEl = $("aiError");
    // Clear old results when starting a new request
    if (respEl) { respEl.hidden = true; respEl.textContent = ""; }
    if (errEl) { errEl.hidden = true; errEl.textContent = ""; }

    let timer = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      const r = await fetch("/api/gemma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
        signal: controller.signal,
      });
      const body = await r.json();

      if (!r.ok || !body.ok) {
        throw new Error(body.error || "AI service returned an error.");
      }

      // Preserve new response after completion
      if (respEl) {
        respEl.hidden = false;
        // Safe rendering: use textContent only (never innerHTML for model text)
        const p = document.createElement("p");
        p.textContent = body.response || "";
        respEl.appendChild(p);
        const dis = document.createElement("p");
        dis.className = "note";
        dis.textContent = body.disclaimer || "Educational information only — not a diagnosis.";
        respEl.appendChild(dis);
      }
    } catch (e) {
      // Preserve new error after completion
      if (errEl) {
        errEl.hidden = false;
        if (e.name === "AbortError") {
          errEl.textContent = "The AI assistant took too long to respond. Please try again.";
        } else if (e.message && /rate limit/i.test(e.message)) {
          errEl.textContent = "AI rate limit exceeded. Please wait a moment and try again.";
        } else {
          errEl.textContent =
            "AI assistant is temporarily unavailable. Please check your internet connection and try again.";
        }
      }
    } finally {
      // Always clear the pending timeout and reset loading UI
      if (timer) clearTimeout(timer);
      aiSetLoading(false);
    }
  };
}
