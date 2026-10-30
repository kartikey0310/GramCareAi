const V = "gc-v4",
  CORE = [
    "/index.html",
    "/style.css",
    "/app.js",
    "/manifest.json",
    "/icon.svg",
  ],
  EMPTY = () => ({ net: 0, cache: 0, netReq: 0, cacheReq: 0, types: {} });
const idb = () =>
  new Promise((s, j) => {
    const r = indexedDB.open("gc-stats", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => s(r.result);
    r.onerror = () => j(r.error);
  });
const kv = async (m, k, v) => {
  const d = await idb();
  return new Promise((s, j) => {
    const o = d
        .transaction("kv", m === "get" ? "readonly" : "readwrite")
        .objectStore("kv"),
      q = m === "get" ? o.get(k) : o.put(v, k);
    q.onsuccess = () => s(q.result);
    q.onerror = () => j(q.error);
  });
};
let chain = Promise.resolve(),
  sim = null;
const add = (kind, b, type) =>
  (chain = chain
    .then(async () => {
      const s = (await kv("get", "stats")) || EMPTY();
      if (kind === "net") {
        s.net += b;
        s.netReq++;
        s.types[type] = (s.types[type] || 0) + b;
      } else {
        s.cache += b;
        s.cacheReq++;
      }
      await kv("put", "stats", s);
    })
    .catch(() => {}));
const size = async (r) => {
  try {
    return (await r.clone().arrayBuffer()).byteLength;
  } catch {
    return 0;
  }
};
const getSim = async () =>
  sim === null ? (sim = !!(await kv("get", "sim").catch(() => 0))) : sim;
const off503 = () =>
  new Response('{"error":"offline"}', {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
const kind = (u) =>
  u.endsWith(".js")
    ? "script"
    : u.endsWith(".css")
      ? "style"
      : u.endsWith(".html")
        ? "document"
        : "other";
async function precache() {
  const c = await caches.open(V);
  await Promise.all(
    CORE.map(async (u) => {
      const r = await fetch(u, { cache: "reload" });
      if (r.ok) {
        add("net", await size(r), kind(u));
        await c.put(u, r);
      }
    }),
  );
}
self.addEventListener("install", (e) =>
  e.waitUntil(precache().then(() => self.skipWaiting())),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((k) =>
        Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x))),
      )
      .then(() => clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin === location.origin) e.respondWith(handle(e.request, u));
});
async function handle(r, u) {
  const api = u.pathname.startsWith("/api/"),
    off = await getSim(),
    c = await caches.open(V);
  if (r.method !== "GET") {
    if (off) return off503();
    try {
      const rq = await size(r.clone().body ? r.clone() : new Response("")),
        res = await fetch(r);
      add("net", rq + (await size(res)), "api");
      return res;
    } catch {
      return off503();
    }
  }
  if (api) {
    if (!off)
      try {
        const res = await fetch(r);
        if (res.ok) {
          add("net", await size(res), "api");
          c.put(r, res.clone());
        }
        return res;
      } catch {}
    const h = await c.match(r);
    return h || off503();
  }
  const h = await c.match(r.mode === "navigate" ? "/index.html" : r, {
    ignoreSearch: true,
  });
  if (h) {
    add("cache", await size(h));
    return h;
  }
  if (off) return new Response("Offline", { status: 503 });
  const res = await fetch(r);
  if (res.ok) {
    add(
      "net",
      await size(res),
      kind(u.pathname) === "other" ? "other" : kind(u.pathname),
    );
    c.put(r, res.clone());
  }
  return res;
}
self.addEventListener("message", (e) => {
  const d = e.data || {},
    p = e.ports[0];
  e.waitUntil(
    (async () => {
      if (d.t === "sim") {
        sim = !!d.sim;
        await kv("put", "sim", sim);
      } else if (d.t === "reset") {
        await chain;
        await kv("put", "stats", EMPTY());
      } else if (d.t === "refresh") {
        await precache();
      } else if (d.t === "stats") {
        await chain;
        const c = await caches.open(V);
        p &&
          p.postMessage({
            stats: (await kv("get", "stats")) || EMPTY(),
            cached: (await c.keys()).filter((k) =>
              CORE.includes(new URL(k.url).pathname),
            ).length,
          });
        return;
      }
      p && p.postMessage(1);
    })(),
  );
});
