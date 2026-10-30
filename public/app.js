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
  if (x.error) {
    $("pmsg").textContent = x.error;
    $("pmsg").style.color = "#d4202c";
  } else {
    $("pmsg").textContent = "Saved " + x.id;
    $("pmsg").style.color = "#2d5a3e";
    $("pn").value = "";
    $("pa").value = "";
    $("pv").value = "";
    $("pm").value = "";
    patients();
  }
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
let cart = JSON.parse(localStorage.getItem("gc_cart") || "[]");
function drawCart() {
  $("cartCount").textContent = cart.length;
  $("total").textContent = cart.reduce((s, m) => s + m.price, 0);
  localStorage.setItem("gc_cart", JSON.stringify(cart));
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
  say = (t, l = $("vl").value) => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = l || "en-IN";
      speechSynthesis.speak(u);
    }
  };

/* ---- Voice Conversation Session, History & Playback (Backend + Offline Memory) ---- */
let currentVoiceSessionId = null;
let lastSavedVoiceSession = null;

function formatRelativeTime(dateStr) {
  if (!dateStr) return "recently";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (isNaN(diff) || diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getAssistantReply(text, lang) {
  const isHi = lang === "hi-IN";
  const c = classify(text);

  if (!c) {
    return isHi
      ? "मैं आपकी बात सुन रहा हूँ। कृपया समस्या का विवरण बताएं (जैसे बुखार, सीने में दर्द, या चोट) ताकि हम तुरंत उचित सहायता प्रदान कर सकें।"
      : "I hear you. Please describe what happened or any symptoms you or the patient are experiencing so I can assist.";
  }

  if (c.problem === "Chest pain") {
    return isHi
      ? "सीने में दर्द एक गंभीर आपातकाल हो सकता है। मरीज को शांत बैठाएं और तंग कपड़े ढीले करें। क्या तुरंत एम्बुलेंस रवाना करें?"
      : "Severe chest pain requires urgent attention. Keep the patient seated upright and calm. Should I dispatch an emergency ambulance now?";
  }
  if (c.problem === "Difficulty breathing") {
    return isHi
      ? "सांस लेने में तकलीफ दर्ज की गई है। मरीज को खुली हवा में सीधा बैठाएं। आपातकालीन सहायता तैयार की जा रही है।"
      : "Difficulty breathing noted. Keep the patient upright in fresh air. Emergency response is being arranged.";
  }
  if (c.problem === "Accident / injury") {
    return isHi
      ? "चोट और रक्तस्राव: साफ कपड़े से घाव को कसकर दबाएं। आपातकालीन दल को सूचना भेजी जा रही है।"
      : "Accident / injury noted. Apply firm pressure to any bleeding using a clean cloth. Preparing emergency dispatch.";
  }
  if (c.problem === "Pregnancy emergency") {
    return isHi
      ? "प्रसव / गर्भावस्था आपातकाल: मरीज को बाईं करवट आराम से लिटाएं और शांत रखें। आपातकालीन वाहन तैयार किया जा रहा है।"
      : "Pregnancy emergency noted. Keep the patient comfortable and resting on her left side. Preparing emergency transport.";
  }
  if (c.problem === "Unconscious / fainting") {
    return isHi
      ? "मरीज बेहोश है: सांस की जांच करें और करवट से लिटाएं (रिकवरी पोजिशन)। मुंह में पानी या दवाई बिल्कुल न दें।"
      : "Patient unconscious. Check breathing and place them on their side in recovery position. Never give liquids. Help is being notified.";
  }
  if (c.problem === "Snake / animal bite") {
    return isHi
      ? "सांप या जानवर का काटना: मरीज को शांत और स्थिर रखें ताकि जहर न फैले। घाव को काटें या बांधें नहीं। तुरंत डॉक्टर की जरूरत है।"
      : "Bite emergency. Keep the patient still and calm to slow venom circulation. Do not cut or suck the bite. Immediate care needed.";
  }
  if (c.kind === "ambulance") {
    return isHi
      ? "आपातकालीन वाहन का अनुरोध प्राप्त हुआ। क्या आप नजदीकी 108/112 एम्बुलेंस रवाना करना चाहते हैं?"
      : "Emergency assistance requested. Would you like to confirm immediate ambulance dispatch?";
  }
  return isHi
    ? "डॉक्टर / आशा कार्यकर्ता परामर्श दर्ज किया गया है। आप नीचे 'निगरानी' (Monitoring) भाग में दिल की धड़कन और ऑक्सीजन भी जांच सकते हैं।"
    : "Doctor / ASHA assistance recorded. You can also monitor pulse and oxygen in the Monitoring section below.";
}

function renderMessage(msg) {
  const tl = $("voiceTimeline");
  if (!tl) return;
  const isUser = msg.sender === "user";
  const div = document.createElement("div");
  div.className = `conv-msg ${isUser ? "user" : "assistant"}`;

  const timeStr = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  div.innerHTML = `
    <div class="conv-msg-header">
      <span class="conv-sender">${isUser ? "👤 You" : "🩺 GramCare AI"}</span>
      <span class="conv-time">${timeStr}</span>
    </div>
    <div class="conv-bubble">
      ${msg.text}
      <div>
        <button class="btn-replay-audio" type="button" title="Listen to this message">
          🔊 Replay audio
        </button>
      </div>
    </div>
  `;

  div.querySelector(".btn-replay-audio").onclick = () => {
    say(msg.text, msg.lang || "en-IN");
  };

  tl.appendChild(div);
  tl.scrollTop = tl.scrollHeight;
}

async function checkLastVoiceSession() {
  try {
    const res = await api("/api/voice/session/latest");
    if (res && res.has_session && res.session) {
      lastSavedVoiceSession = res;
      $("voiceResumeCard").style.display = "block";
      $("resumeTopic").innerHTML = `<strong>Last active conversation:</strong> ${res.session.title || "Voice Consultation"}`;
      $("resumeTime").textContent = `Saved ${formatRelativeTime(res.session.updated_at)}`;
      const preview = res.session.last_prompt ||
        (res.messages && res.messages.length ? res.messages[res.messages.length - 1].text : "Saved checkpoint ready.");
      $("resumePreview").textContent = preview;
    } else {
      $("voiceResumeCard").style.display = "none";
    }
  } catch (err) {
    console.warn("Could not check last voice session:", err);
  }
}

// Resume from last saved point button
$("btnResumeVoice").onclick = () => {
  if (!lastSavedVoiceSession) return;
  const { session, messages } = lastSavedVoiceSession;
  currentVoiceSessionId = session.id;

  $("voiceResumeCard").style.display = "none";
  $("voiceConversation").style.display = "block";
  $("convBadge").textContent = "Resumed";
  $("voiceTimeline").innerHTML = "";

  // Render all previous messages
  if (messages && messages.length) {
    messages.forEach((m) => renderMessage(m));
  }

  // Show checkpoint marker
  $("voiceResumeMarker").style.display = "flex";

  // Prompt user and play last assistant response / continuation
  const resumeSpoken = hi()
    ? `पिछली बातचीत से जारी कर रहे हैं। ${session.last_prompt || "कृपया आगे बताएं।"}`
    : `Resuming conversation from last point. ${session.last_prompt || "How can I help you proceed?"}`;

  $("vmsg").textContent = hi()
    ? "पिछली बातचीत फिर से शुरू हुई। बोलें या टाइप करें।"
    : "Resumed previous session from last saved point. Speak or type to continue.";

  say(resumeSpoken, $("vl").value);
  $("voiceConversation").scrollIntoView({ behavior: "smooth", block: "center" });
};

// Dismiss / Start fresh button on banner
$("btnDismissResume").onclick = async () => {
  try {
    await api("/api/voice/session/clear", {
      method: "POST",
      body: JSON.stringify({ session_id: lastSavedVoiceSession ? lastSavedVoiceSession.session.id : "" }),
    });
  } catch {}
  lastSavedVoiceSession = null;
  currentVoiceSessionId = null;
  $("voiceResumeCard").style.display = "none";
  toast("Cleared previous checkpoint. Ready for a new conversation.");
};

// Start new session inside the conversation card
$("btnClearVoice").onclick = async () => {
  try {
    await api("/api/voice/session/clear", {
      method: "POST",
      body: JSON.stringify({ session_id: currentVoiceSessionId || "" }),
    });
  } catch {}
  currentVoiceSessionId = null;
  lastSavedVoiceSession = null;
  $("voiceTimeline").innerHTML = "";
  $("voiceResumeMarker").style.display = "none";
  $("voiceConversation").style.display = "none";
  $("convBadge").textContent = "Active";
  toast("Started fresh voice session");
};

// Explicit Save Checkpoint button
$("btnSavePoint").onclick = () => {
  if (!currentVoiceSessionId) {
    toast("No active conversation to save yet.");
    return;
  }
  toast("Checkpoint saved! You can resume anytime.");
};

// Check for previous session on startup
checkLastVoiceSession();

let cd;
async function handle(t) {
  const lang = $("vl").value;
  $("voiceConversation").style.display = "block";

  // Ensure active session in backend
  if (!currentVoiceSessionId) {
    try {
      const s = await api("/api/voice/session", {
        method: "POST",
        body: JSON.stringify({ title: t.slice(0, 40) }),
      });
      if (s && s.session_id) currentVoiceSessionId = s.session_id;
    } catch {
      currentVoiceSessionId = `VS-${Date.now()}`;
    }
  }

  // 1. Record & render user spoken message
  const userMsg = {
    session_id: currentVoiceSessionId,
    sender: "user",
    text: t,
    lang,
    created_at: new Date().toISOString(),
  };
  renderMessage(userMsg);
  api("/api/voice/message", {
    method: "POST",
    body: JSON.stringify(userMsg),
  }).catch(() => {});

  // 2. Generate assistant response
  const replyText = getAssistantReply(t, lang);
  const assistantMsg = {
    session_id: currentVoiceSessionId,
    sender: "assistant",
    text: replyText,
    lang,
    created_at: new Date().toISOString(),
  };
  renderMessage(assistantMsg);
  api("/api/voice/message", {
    method: "POST",
    body: JSON.stringify(assistantMsg),
  }).catch(() => {});

  // 3. Speak assistant reply
  say(replyText, lang);

  // 4. Emergency classification & confirmation popup
  const c = classify(t),
    box = $("confirm");
  if (!c) {
    $("vmsg").textContent = hi()
      ? "अपनी समस्या बताएं या नीचे दिए गए बटनों पर टैप करें।"
      : "Describe your symptoms or tap a quick button below.";
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
/* vitals: clinical threshold assessment, works offline */
const assessVitals = (hr, spo2, temp, rr) => {
  const issues = [];
  let severity = "NORMAL";

  if (hr < 30 || hr > 220 || spo2 < 50 || spo2 > 100 || temp < 30 || temp > 45 || (rr && (rr < 6 || rr > 40))) {
    return { flag: "INVALID", message: "Re-check the measurement", issues: ["Invalid reading"] };
  }

  if (hr < 60) issues.push("Bradycardia (low heart rate)");
  else if (hr > 100) issues.push("Tachycardia (high heart rate)");

  if (spo2 < 90) { issues.push("Severe hypoxemia (very low SpO₂)"); severity = "URGENT"; }
  else if (spo2 < 94) { issues.push("Low SpO₂"); if (severity !== "URGENT") severity = "REVIEW"; }

  if (temp < 35) { issues.push("Hypothermia (low temperature)"); severity = "URGENT"; }
  else if (temp >= 39.5) { issues.push("Hyperpyrexia (very high fever)"); severity = "URGENT"; }
  else if (temp >= 38) { issues.push("Fever"); if (severity !== "URGENT") severity = "REVIEW"; }

  if (rr) {
    if (rr < 12) issues.push("Bradypnea (low respiratory rate)");
    else if (rr > 20) issues.push("Tachypnea (high respiratory rate)");
  }

  if (severity === "NORMAL" && issues.length === 0) {
    return { flag: "NORMAL", message: "All vitals within normal range", issues: [] };
  }
  return { flag: severity, message: issues.join(" · "), issues };
};

const edge = (h, s, t) => {
  const r = assessVitals(h, s, t);
  return r.flag;
};
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
    const r = assessVitals(h, s, t);
    x = {
      flag: r.flag,
      message: r.message + " (checked on this device)",
      issues: r.issues,
    };
  }
  $("flag").innerHTML =
    `<span class="chip ${x.flag}">${x.flag}</span> ${x.message}${
      x.issues && x.issues.length
        ? '<ul class="vitals-issues">' +
          x.issues.map((i) => "<li>" + i + "</li>").join("") +
          "</ul>"
        : ""
    }`;
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
