"use strict";
/* Leaf Launcher — l'interface. Parle au backend Rust par les commandes Tauri et ses événements. */

// ───────────────────────── Pont Tauri (ou aperçu dans un navigateur) ─────────────────────────
const TAURI = window.__TAURI__;
const invoke = TAURI ? TAURI.core.invoke : mockInvoke;
const listen = TAURI ? TAURI.event.listen : () => {};
const appWindow = TAURI ? TAURI.window.getCurrentWindow() : null;

const S = {
  settings: {}, accounts: [], instances: [], running: new Set(), preparing: null, installed: new Set(),
  manifest: null, notes: null, page: "home", totalMem: 16384, logs: {}, consoleId: null, progress: null,
  instFilter: "all", instSearch: "", instSort: "recent", version: "",
};

// ───────────────────────── Outils ─────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtBytes = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + " Go" : b > 1e6 ? Math.round(b / 1e6) + " Mo" : Math.round(b / 1e3) + " Ko";
const fmtTime = (s) => {
  if (!s) return "0 min";
  const hh = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60);
  return hh ? `${hh} h ${String(mm).padStart(2, "0")}` : `${mm} min`;
};
const ago = (t) => {
  if (!t) return "Jamais";
  const d = Date.now() / 1000 - t;
  if (d < 60) return "À l'instant";
  if (d < 3600) return `Il y a ${Math.round(d / 60)} min`;
  if (d < 86400) return `Il y a ${Math.round(d / 3600)} h`;
  if (d < 86400 * 30) return `Il y a ${Math.round(d / 86400)} j`;
  return new Date(t * 1000).toLocaleDateString("fr-FR");
};
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
const LOADERS = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };
const HORIZON_VERSION = "26.3";
const isRust = (inst) => inst && inst.engine === "horizon";
const KINDS = { release: "Release", snapshot: "Snapshot", old_beta: "Bêta", old_alpha: "Alpha" };

const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  loader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  ms: '<svg viewBox="0 0 24 24"><path fill="#f35325" d="M2 2h9.5v9.5H2z"/><path fill="#81bc06" d="M12.5 2H22v9.5h-9.5z"/><path fill="#05a6f0" d="M2 12.5h9.5V22H2z"/><path fill="#ffba08" d="M12.5 12.5H22V22h-9.5z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 6.3-6.3a4 4 0 0 0-5-5L10 5l1-1z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M11 7v10M15 7v10M7 17v3M17 17v3"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6 0 6 0s1 3 0 6l-7 7-6-6z"/><circle cx="15" cy="9" r="1.5"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 5.2A17 17 0 0 0 15.4 4l-.5 1a15.7 15.7 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.2 1.2C1.8 9.2 1.1 13.1 1.4 17a17 17 0 0 0 5.2 2.6l1.1-1.7a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.2 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a17 17 0 0 0 5.2-2.6c.4-4.5-.7-8.4-3-11.8zM8.7 14.6c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>',
  rust: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/><path d="M9.5 10h3.2a1.3 1.3 0 0 1 0 2.6H9.5V10zm0 2.6V15M12.4 12.6 14.5 15"/></svg>',
  puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
};

// ───────────────────────── Blocs isométriques (icônes d'instance) ─────────────────────────
const CUBES = {
  grass: ["#7bd34f", "#7a5534", "#5e4128", "#5fae3a"], stone: ["#a3a8ad", "#7f8489", "#62676c"], diamond: ["#7ef2ea", "#3fc4bd", "#2a9b96"],
  gold: ["#fde047", "#e2b11a", "#b8860b"], redstone: ["#ff5a4f", "#c8261c", "#931b14"], emerald: ["#4ce58a", "#1fae5a", "#167a40"],
  nether: ["#b83a3a", "#7d2020", "#571616"], end: ["#f2efb6", "#d4cf86", "#ada75f"], ice: ["#c9ecff", "#93cdf2", "#6aa9d2"],
  sand: ["#f3e3a9", "#dbc681", "#b9a463"], wood: ["#c79a5b", "#9b7340", "#77562e"], amethyst: ["#c79bff", "#9a66e0", "#7445b5"],
  obsidian: ["#4a3a6b", "#2c2240", "#1d162c"], copper: ["#f0a070", "#c46f43", "#96502d"], cherry: ["#ffc0d9", "#f08cb5", "#c9628c"], sculk: ["#1f6d73", "#0f3e44", "#0a2a2e"],
};
const CUBE_NAMES = Object.keys(CUBES);
function cubeSVG(kind = "grass", cls = "cube") {
  const c = CUBES[kind] || CUBES.grass;
  const top = c[0], left = c[1], right = c[2];
  const grass = kind === "grass";
  return `<svg class="${cls}" viewBox="0 0 64 64"><defs><linearGradient id="g-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <path d="M32 6 58 20 32 34 6 20z" fill="${top}"/><path d="M32 6 58 20 32 34 6 20z" fill="url(#g-${kind})"/>
    <path d="M6 20 32 34v24L6 44z" fill="${left}"/><path d="M58 20 32 34v24l26-14z" fill="${right}"/>
    ${grass ? `<path d="M6 20 32 34v6L6 26z" fill="${c[3]}"/><path d="M58 20 32 34v6l26-14z" fill="#4e9330"/>` : ""}
    <path d="M32 34v24M6 20l26 14 26-14" stroke="#000" stroke-opacity=".18" stroke-width="1" fill="none"/>
    <path d="M14 22l4 2M40 14l5 2.5M24 12l3 1.5" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/></svg>`;
}
const cubeColor = (kind) => (CUBES[kind] || CUBES.grass)[0];

// ───────────────────────── Fond animé : aurore et particules ─────────────────────────
const BG = (() => {
  const canvas = $("#bg"), ctx = canvas.getContext("2d");
  let w = 0, h = 0, t = 0, mouse = { x: .5, y: .5 }, particles = [], running = true;
  function resize() {
    const r = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.width = innerWidth * r; h = canvas.height = innerHeight * r;
    const density = (S.settings.theme && S.settings.theme.density) ?? 1;
    particles = Array.from({ length: Math.round((innerWidth * innerHeight) / 26000 * density) }, () => ({
      x: Math.random() * w, y: Math.random() * h, s: Math.random() * 2.4 + .6, v: Math.random() * .25 + .05, d: Math.random() * Math.PI * 2, z: Math.random(),
    }));
  }
  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").split(",").map(Number);
    return v.length === 3 ? v : [74, 222, 128];
  }
  function frame() {
    if (!running) return;
    const settings = S.settings;
    const th = settings.theme || {};
    const speed = th.speed ?? 1;
    t += settings.animations === false ? 0 : 0.004 * speed;
    ctx.clearRect(0, 0, w, h);
    const [r, g, b] = accent();
    const mode = settings.background || "aurora";
    if (mode === "aurora" || mode === "image") {
      const blobs = [
        [0.18 + Math.sin(t * 1.3) * .08, 0.25 + Math.cos(t) * .1, 0.55, `rgba(${r},${g},${b},.16)`],
        [0.85 + Math.cos(t * .9) * .07, 0.8 + Math.sin(t * 1.1) * .08, 0.6, `rgba(${Math.min(255, b + 40)},${r},${g},.10)`],
        [0.6 + Math.sin(t * .7) * .12, 0.1 + Math.cos(t * 1.4) * .06, 0.45, `rgba(${g},${b},${r},.07)`],
      ];
      for (const [x, y, rad, col] of blobs) {
        const px = (x + (mouse.x - .5) * .04) * w, py = (y + (mouse.y - .5) * .04) * h;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, rad * Math.max(w, h));
        grd.addColorStop(0, col); grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      }
    }
    if (mode === "gradient") {
      const grd = ctx.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, th.gradA || "#0d2a1f"); grd.addColorStop(1, th.gradB || "#05070a");
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    }
    const style = th.particleStyle || "pixels";
    if (settings.particles !== false && mode !== "minimal" && style !== "none") {
      const falling = style === "snow" || style === "leaves";
      for (const p of particles) {
        if (settings.animations !== false) {
          const v = p.v * (1 + p.z) * speed;
          if (falling) p.y += v; else p.y -= v;
          p.x += Math.sin(t * 3 + p.d) * (style === "leaves" ? .9 : .3);
          if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
          if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        }
        const px = p.x + (mouse.x - .5) * 30 * p.z, py = p.y + (mouse.y - .5) * 30 * p.z;
        const a = .15 + .35 * p.z * (0.6 + 0.4 * Math.sin(t * 8 + p.d));
        const [pr, pg, pb] = th.particleColor ? hexRgb(th.particleColor) : [r, g, b];
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${a})`;
        ctx.strokeStyle = ctx.fillStyle;
        const sz = p.s * (th.particleSize ?? 1);
        if (style === "pixels") ctx.fillRect(px, py, sz, sz);
        else if (style === "snow" || style === "dots") { ctx.beginPath(); ctx.arc(px, py, sz * .9, 0, 7); ctx.fill(); }
        else if (style === "bubbles") { ctx.beginPath(); ctx.arc(px, py, sz * 2.2, 0, 7); ctx.lineWidth = 1; ctx.stroke(); }
        else if (style === "stars") {
          const k = sz * (1.5 + Math.sin(t * 10 + p.d));
          ctx.fillRect(px - k, py - .5, k * 2, 1); ctx.fillRect(px - .5, py - k, 1, k * 2);
        } else if (style === "leaves") {
          ctx.save(); ctx.translate(px, py); ctx.rotate(t * 2 + p.d);
          ctx.beginPath(); ctx.ellipse(0, 0, sz * 2.4, sz * 1.1, 0, 0, 7); ctx.fill(); ctx.restore();
        } else if (style === "embers") {
          ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; ctx.fillRect(px, py, sz, sz); ctx.shadowBlur = 0;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  addEventListener("resize", resize);
  addEventListener("mousemove", (e) => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; });
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
  resize(); requestAnimationFrame(frame);
  return { resize };
})();
function hexRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [74, 222, 128];
}

// ───────────────────────── Sons d'interface (synthétisés) ─────────────────────────
const Sound = (() => {
  let ac;
  function tone(freq, dur, type = "sine", vol = .04, slide = 0) {
    if (!S.settings.sounds) return;
    try {
      ac ||= new AudioContext();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, ac.currentTime + dur);
      g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
    } catch { /* pas d'audio */ }
  }
  return {
    tick: () => tone(1800, .05, "triangle", .015),
    nav: () => tone(520, .12, "sine", .03, 1.5),
    play: () => { tone(392, .18, "triangle", .05, 1.5); setTimeout(() => tone(587, .3, "triangle", .05, 1.3), 110); },
    ok: () => { tone(660, .12, "sine", .04); setTimeout(() => tone(990, .2, "sine", .04), 90); },
    err: () => tone(220, .25, "sawtooth", .025, .7),
  };
})();

// ───────────────────────── Toasts ─────────────────────────
function toast(title, text = "", kind = "ok", ms = 4200) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="ti">${kind === "error" ? I.alert : I.check}</div><div><b>${h(title)}</b>${text ? `<span>${h(text)}</span>` : ""}</div><div class="timer" style="animation-duration:${ms}ms"></div>`;
  $("#toasts").append(el);
  (kind === "error" ? Sound.err : Sound.ok)();
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 400); };
  el.onclick = close;
  setTimeout(close, ms);
}
const fail = (e) => toast("Oups", String(e), "error", 7000);

// ───────────────────────── Fenêtre ─────────────────────────
$("#wMin").onclick = () => appWindow?.minimize();
$("#wMax").onclick = () => appWindow?.toggleMaximize();
$("#wClose").onclick = () => appWindow?.close();

// ───────────────────────── Thème ─────────────────────────
function applyTheme() {
  const s = S.settings;
  document.documentElement.dataset.accent = s.accent || "leaf";
  document.body.classList.toggle("no-anim", s.animations === false);
  document.body.classList.toggle("no-glass", s.glass === false);
  window.applyCustomTheme?.();
}

// ───────────────────────── Navigation ─────────────────────────
function moveIndicator() {
  const btn = $(`#nav button[data-page="${S.page}"]`);
  const ind = $("#navIndicator");
  if (btn) ind.style.transform = `translateY(${btn.offsetTop}px)`;
}
function stagger(root) {
  $$("[data-stagger]", root).forEach((list) => [...list.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 14))));
}
const RENDER = {};
function go(page, opts = {}) {
  if (S.page !== page) Sound.nav();
  S.page = page;
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  moveIndicator();
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  const el = $(`#page-${page}`);
  RENDER[page]?.(el, opts);
  stagger(el);
  el.scrollTop = 0;
}
$$("#nav button").forEach((b) => (b.onclick = () => go(b.dataset.page)));
$("#accountBtn").onclick = () => go("accounts");

// Rejouer les animations d'entrée d'une page déjà affichée.
function rerender() {
  const el = $(`#page-${S.page}`);
  RENDER[S.page]?.(el, {});
  stagger(el);
}

// ───────────────────────── Effets : ripple et inclinaison 3D ─────────────────────────
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn, .play, .vchip, .loader-card");
  if (!b || S.settings.animations === false) return;
  const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  const rip = document.createElement("span");
  rip.className = "ripple";
  Object.assign(rip.style, { width: size + "px", height: size + "px", left: e.clientX - r.left - size / 2 + "px", top: e.clientY - r.top - size / 2 + "px" });
  if (getComputedStyle(b).position === "static") b.style.position = "relative";
  b.style.overflow = "hidden";
  b.append(rip); setTimeout(() => rip.remove(), 700);
});
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest(".inst-card:not(.inst-new)");
  $$(".inst-card.tilting").forEach((c) => { if (c !== card) { c.classList.remove("tilting"); c.style.transform = ""; } });
  if (!card || S.settings.animations === false) return;
  const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  card.classList.add("tilting");
  card.style.setProperty("--mx", x * 100 + "%"); card.style.setProperty("--my", y * 100 + "%");
  card.style.transform = `perspective(800px) rotateY(${(x - .5) * 10}deg) rotateX(${(.5 - y) * 10}deg) translateY(-4px)`;
});

// Les segments (onglets à curseur glissant).
function seg(options, value, onChange, id) {
  return `<div class="seg" data-seg="${id}"><div class="seg-thumb"></div>${options.map(([v, l]) => `<button data-v="${h(v)}" class="${v === value ? "on" : ""}">${h(l)}</button>`).join("")}</div>`;
}
function bindSeg(root, id, onChange) {
  const el = $(`[data-seg="${id}"]`, root);
  if (!el) return;
  const place = () => {
    const on = $("button.on", el), th = $(".seg-thumb", el);
    if (on) { th.style.width = on.offsetWidth + "px"; th.style.transform = `translateX(${on.offsetLeft - 4}px)`; }
  };
  $$("button", el).forEach((b) => (b.onclick = () => {
    $$("button", el).forEach((x) => x.classList.toggle("on", x === b));
    place(); Sound.tick(); onChange(b.dataset.v);
  }));
  requestAnimationFrame(place);
}

// ───────────────────────── Données ─────────────────────────
async function refresh() {
  const b = await invoke("bootstrap");
  S.settings = b.settings; S.accounts = b.accounts; S.instances = b.instances;
  S.running = new Set(b.running); S.preparing = b.preparing; S.installed = new Set(b.installed);
  S.totalMem = b.total_memory_mb || 16384; S.dataDir = b.data_dir; S.version = b.version; S.horizon = b.horizon; S.msaBuiltin = b.msa_builtin;
  applyTheme(); renderAccountBtn();
}
async function saveSettings(patch = {}) {
  Object.assign(S.settings, patch);
  applyTheme();
  try { await invoke("save_settings", { settings: S.settings }); } catch (e) { fail(e); }
}
async function loadManifest(force = false) {
  if (S.manifest && !force) return S.manifest;
  S.manifest = await invoke("list_versions", { refresh: force });
  if (S.manifest.offline) toast("Hors ligne", "Liste des versions lue depuis le cache.", "ok");
  return S.manifest;
}
async function loadNotes() {
  if (S.notes) return S.notes;
  try { S.notes = await invoke("patch_notes"); } catch { S.notes = []; }
  return S.notes;
}
const activeAccount = () => S.accounts.find((a) => a.uuid === S.settings.active_account);
const selected = () => S.instances.find((i) => i.id === S.settings.selected_instance) || sortedInstances()[0];
function sortedInstances(list = S.instances) {
  return [...list].sort((a, b) => (b.favorite - a.favorite) || ((b.last_played || b.created) - (a.last_played || a.created)));
}
const headUrl = (a, size = 64) => a.kind === "microsoft" ? `https://mc-heads.net/avatar/${a.uuid}/${size}` : `https://mc-heads.net/avatar/MHF_Steve/${size}`;
function noteFor(version) {
  if (!S.notes) return null;
  return S.notes.find((n) => n.version === version && n.image) || S.notes.find((n) => n.image && version && String(n.version).startsWith(version.split("-")[0]));
}

function renderAccountBtn() {
  const a = activeAccount();
  $("#accountBtn").innerHTML = a ? `<img src="${headUrl(a)}" alt="" data-fallback="user"><span class="dot ${a.kind === "offline" ? "off" : ""}"></span>` : `<div class="ph">${I.user}</div>`;
  $("#accountBtn").title = a ? `${a.name} (${a.kind === "microsoft" ? "Microsoft" : "hors ligne"})` : "Ajouter un compte";
}

// ───────────────────────── Bouton Jouer ─────────────────────────
function playButton(inst, big = true) {
  const running = S.running.has(inst.id), busy = S.preparing === inst.id;
  const p = S.progress && S.progress.id === inst.id ? S.progress : null;
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  const state = running ? "running" : busy ? "busy" : "";
  const label = running ? "EN JEU" : busy ? (p ? `${pct} %` : "PRÉPARATION") : "JOUER";
  const sub = running ? "Cliquer pour arrêter" : busy ? (p ? `${h(p.stage)} · ${p.done}/${p.total}` : "Démarrage…") : "";
  return `<button class="play ${state}" data-play="${inst.id}" ${big ? "" : 'style="min-width:0;height:48px"'}>
    <span class="fill" style="transform:scaleX(${busy ? pct / 100 : 0})"></span>
    <span class="play-ico">${busy ? I.loader : I.play}</span>
    <span class="play-text"><span>${label}</span><span class="play-sub">${sub}</span></span></button>`;
}
function updatePlayButtons() {
  $$("[data-play]").forEach((b) => {
    const inst = S.instances.find((i) => i.id === b.dataset.play);
    if (!inst) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = playButton(inst, !b.style.minWidth);
    const nb = tmp.firstElementChild;
    if (b.className !== nb.className) { b.replaceWith(nb); bindPlay(nb.parentElement); }
    else { b.innerHTML = nb.innerHTML; }
  });
  $$(".inst-card[data-id]").forEach((c) => {
    const run = S.running.has(c.dataset.id);
    const badge = $(".badge-run", c);
    if (run && !badge) c.insertAdjacentHTML("beforeend", `<span class="chip accent badge-run"><i></i>En jeu</span>`);
    if (!run && badge) badge.remove();
  });
}
function bindPlay(root) {
  $$("[data-play]", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); play(b.dataset.play); }));
}
async function play(id, repair = false) {
  if (S.running.has(id)) {
    try { await invoke("stop_game", { id }); toast("Jeu arrêté"); } catch (e) { fail(e); }
    return;
  }
  if (S.preparing === id) { await invoke("cancel_launch"); return; }
  if (!activeAccount()) { toast("Aucun compte", "Ajoute un compte Microsoft ou hors ligne pour jouer.", "error"); go("accounts"); return; }
  try {
    Sound.play();
    S.preparing = id; S.progress = null;
    await saveSettings({ selected_instance: id });
    await invoke("launch", { id, repair });
    showTask(true);
    updatePlayButtons();
    if (S.settings.open_console) { S.consoleId = id; go("console"); }
  } catch (e) { S.preparing = null; updatePlayButtons(); fail(e); }
}
function showTask(on, text = "Préparation…", pct = 0) {
  $("#taskPill").classList.toggle("show", on);
  $("#taskText").textContent = text;
  $("#taskBar").style.width = pct + "%";
}

// ───────────────────────── Accueil ─────────────────────────
RENDER.home = async (el) => {
  const inst = selected();
  const acc = activeAccount();
  const hour = new Date().getHours();
  const hello = hour < 6 ? "Bonne nuit" : hour < 18 ? "Bonjour" : "Bonsoir";
  el.innerHTML = `
    <div data-stagger>
      <div class="page-head" style="margin-bottom:18px">
        <div><div class="eyebrow">${hello}${acc ? ", " + h(acc.name) : ""}</div><h1>Prêt à jouer ?</h1></div>
        <button class="btn" id="homeNew">${I.plus} Nouvelle instance</button>
      </div>
      <div class="hero" id="hero">${heroHTML(inst)}</div>
      <div class="section-title"><h2>Versions à la une</h2><button class="link" id="allVersions">Toutes les versions ${I.arrow}</button></div>
      <div class="featured" id="featured">${[0, 1, 2, 3, 4].map(() => `<div class="skeleton" style="width:120px;height:46px"></div>`).join("")}</div>
      <div class="section-title"><h2>Mes instances</h2><button class="link" data-go="instances">Tout voir ${I.arrow}</button></div>
      <div class="row-scroll" id="homeInst">${homeInstances()}</div>
      <div class="section-title"><h2>Quoi de neuf dans Minecraft</h2><button class="link" data-go="news">Toutes les notes ${I.arrow}</button></div>
      <div class="news-grid" id="homeNews">${[0, 1, 2].map(() => `<div class="skeleton" style="height:230px"></div>`).join("")}</div>
    </div>`;
  bindHome(el);
  splitTitle(el);
  // Version à la une et notes, chargées après l'affichage.
  loadManifest().then(() => { if (S.page === "home") renderFeatured(el); }).catch((e) => { $("#featured", el).innerHTML = `<span class="muted">${h(e)}</span>`; });
  loadNotes().then((notes) => {
    if (S.page !== "home") return;
    $("#homeNews", el).innerHTML = notes.slice(0, 3).map(newsCard).join("") || `<div class="muted">Pas de notes disponibles.</div>`;
    bindNews(el);
    const art = $(".hero-art", el), n = inst && noteFor(inst.version);
    if (art && n) { art.classList.remove("gen"); art.style.opacity = 0; $(".hero-float", el)?.remove(); setTimeout(() => { art.style.backgroundImage = `url("${n.image}")`; art.style.opacity = 1; }, 200); }
  });
};
function heroHTML(inst) {
  if (!inst) {
    return `<div class="hero-art gen" style="background:radial-gradient(circle at 75% 30%, rgba(var(--accent-rgb),.35), transparent 50%), linear-gradient(135deg,#0d1f18,#060a09)"></div>
      <div class="hero-body"><div class="hero-empty"><div class="eyebrow">Bienvenue</div><h1 class="split">Ton aventure commence ici</h1>
      <p class="muted" style="max-width:460px">Crée une instance avec la version de ton choix (26.3, 26.2, 26.1, 1.21.11…), en Vanilla, Fabric ou Quilt.</p>
      <button class="btn primary" id="heroCreate">${I.plus} Créer ma première instance</button></div></div>`;
  }
  const n = noteFor(inst.version);
  const tint = cubeColor(inst.icon);
  return `<div class="hero-art ${n ? "" : "gen"}" style="${n ? `background-image:url('${n.image}')` : `background:radial-gradient(circle at 78% 35%, ${tint}55, transparent 55%), radial-gradient(circle at 30% 110%, rgba(var(--accent-rgb),.25), transparent 50%), linear-gradient(135deg,#0d1a16,#050807)`}"></div>
    ${n ? "" : `<div class="hero-float">${cubeSVG(inst.icon, "")}<i></i></div>`}
    <div class="hero-body">
      <div class="hero-info">
        <div class="chips">${isRust(inst) ? `<span class="chip rust"><i></i>Horizon · Rust</span>` : `<span class="chip accent"><i></i>${h(LOADERS[inst.loader] || inst.loader)}</span>`}<span class="chip">${h(inst.version)}</span>${S.installed.has(inst.version) ? `<span class="chip">Installée</span>` : `<span class="chip">À télécharger</span>`}</div>
        <h1 class="split">${h(inst.name)}</h1>
        <div class="meta"><div><b>${fmtTime(inst.playtime)}</b>Temps de jeu</div><div><b>${ago(inst.last_played)}</b>Dernière session</div><div><b>${Math.round((inst.memory_mb || S.settings.memory_mb) / 1024 * 10) / 10} Go</b>Mémoire</div></div>
      </div>
      <div class="hero-actions">
        ${playButton(inst)}
        ${inst.version === HORIZON_VERSION && inst.loader === "vanilla" ? engineSwitch(inst) : ""}
        <div class="row"><button class="btn small" data-folder="instance:${inst.id}">${I.folder} Dossier</button><button class="btn small" data-edit="${inst.id}">${I.gear} Réglages</button><button class="btn small" id="heroSwitch">${I.layers} Changer</button></div>
      </div>
    </div>`;
}
function splitTitle(root) {
  $$(".split", root).forEach((t) => {
    if (S.settings.animations === false) return;
    const text = t.textContent;
    t.innerHTML = [...text].map((c, i) => c === " " ? " " : `<span class="split-char" style="--c:${i}">${h(c)}</span>`).join("");
  });
}
function homeInstances() {
  const list = sortedInstances().slice(0, 10);
  return list.map(instCard).join("") + `<button class="inst-card inst-new" data-new>${`<div class="plus-big">${I.plus}</div>`}<b>Nouvelle instance</b></button>`;
}
function renderFeatured(el) {
  const m = S.manifest;
  const releases = m.versions.filter((v) => v.kind === "release").slice(0, 5);
  const snap = m.versions.find((v) => v.kind === "snapshot");
  const list = [...releases];
  if (snap && m.versions.indexOf(snap) < m.versions.indexOf(releases[0])) list.unshift(snap);
  $("#featured", el).innerHTML = list.map((v, i) => `<button class="vchip" data-quick="${h(v.id)}" style="animation:rise .6s var(--ease-out) both;animation-delay:${i * 60}ms"><span class="plus">${I.plus}</span>${h(v.id)}<small>${v.id === m.latest_release ? "Dernière" : KINDS[v.kind]}</small></button>`).join("");
  $$("[data-quick]", el).forEach((b) => (b.onclick = () => createModal({ version: b.dataset.quick })));
}
function bindHome(el) {
  bindPlay(el); bindCards(el);
  $("#homeNew", el).onclick = () => createModal();
  $("#allVersions", el).onclick = () => createModal();
  $("#heroCreate", el)?.addEventListener("click", () => createModal());
  $("#heroSwitch", el)?.addEventListener("click", () => switcher());
  $$("[data-go]", el).forEach((b) => (b.onclick = () => go(b.dataset.go)));
  bindCommon(el);
}
function bindCommon(el) {
  $$("[data-engine]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleEngine(b.dataset.engine); }));
  $$("[data-folder]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); invoke("open_folder", { target: b.dataset.folder }).catch(fail); }));
  $$("[data-edit]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); instanceDrawer(b.dataset.edit); }));
}

// ───────────────────────── Cartes d'instance ─────────────────────────
function instCard(inst) {
  const sel = S.settings.selected_instance === inst.id;
  return `<div class="inst-card ${sel ? "selected" : ""}" data-id="${inst.id}" style="--card-tint:radial-gradient(circle at 85% 0%, ${cubeColor(inst.icon)}33, transparent 60%)" role="button" tabindex="0">
    <div class="top">${cubeSVG(inst.icon)}<button class="star ${inst.favorite ? "on" : ""}" data-star="${inst.id}" title="Favori">${I.star}</button></div>
    <div><h3>${h(inst.name)}</h3><div class="sub">${h(inst.version)}<span class="sep"></span>${isRust(inst) ? "Rust" : h(LOADERS[inst.loader])}<span class="sep"></span>${ago(inst.last_played)}</div></div>
    ${S.running.has(inst.id) ? `<span class="chip accent badge-run"><i></i>En jeu</span>` : ""}
    <button class="quick" data-play-quick="${inst.id}" title="Jouer">${I.play}</button></div>`;
}
function bindCards(el) {
  $$(".inst-card[data-id]", el).forEach((c) => {
    c.onclick = async () => {
      await saveSettings({ selected_instance: c.dataset.id });
      Sound.tick();
      if (S.page === "home") { const hero = $("#hero"); hero.innerHTML = heroHTML(selected()); bindPlay(hero); bindCommon(hero); $("#heroSwitch", hero)?.addEventListener("click", switcher); splitTitle(hero); $$(".inst-card", el).forEach((x) => x.classList.toggle("selected", x === c)); applyHeroArt(); }
      else instanceDrawer(c.dataset.id);
    };
    c.ondblclick = () => play(c.dataset.id);
  });
  $$("[data-play-quick]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); play(b.dataset.playQuick); }));
  $$("[data-star]", el).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const inst = S.instances.find((i) => i.id === b.dataset.star);
    inst.favorite = !inst.favorite; b.classList.toggle("on", inst.favorite); Sound.tick();
    try { await invoke("update_instance", { instance: inst }); } catch (err) { fail(err); }
  }));
  $$("[data-new]", el).forEach((b) => (b.onclick = () => createModal()));
}
function applyHeroArt() {
  const inst = selected(), art = $(".hero-art"), n = inst && noteFor(inst.version);
  if (art && n) { art.classList.remove("gen"); art.style.backgroundImage = `url("${n.image}")`; $(".hero-float")?.remove(); }
}
function switcher() {
  const m = modal(`<div class="modal-head"><h2>Choisir une instance</h2><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body"><div class="inst-grid" data-stagger>${sortedInstances().map(instCard).join("")}</div></div>`, "wide");
  stagger(m.el);
  $$(".inst-card", m.el).forEach((c) => (c.onclick = async () => { await saveSettings({ selected_instance: c.dataset.id }); m.close(); rerender(); }));
  $$("[data-play-quick]", m.el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); m.close(); play(b.dataset.playQuick); }));
}

// ───────────────────────── Instances ─────────────────────────
RENDER.instances = (el) => {
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Bibliothèque</div><h1>Instances</h1><p>${S.instances.length} instance${S.instances.length > 1 ? "s" : ""}, chacune avec ses mondes, ses mods et ses réglages.</p></div>
      <button class="btn primary" id="instNew">${I.plus} Nouvelle instance</button></div>
    <div class="toolbar">
      <div class="search">${I.search}<input class="input" id="instSearch" placeholder="Rechercher une instance…" value="${h(S.instSearch)}"></div>
      ${seg([["all", "Toutes"], ["vanilla", "Vanilla"], ["fabric", "Fabric"], ["quilt", "Quilt"]], S.instFilter, null, "instFilter")}
      <div class="grow"></div>
      <select class="select" id="instSort" style="width:190px"><option value="recent">Récemment jouées</option><option value="name">Nom</option><option value="version">Version</option><option value="playtime">Temps de jeu</option></select>
    </div>
    <div class="inst-grid" id="instGrid" data-stagger></div>`;
  $("#instSort", el).value = S.instSort;
  const draw = () => {
    const q = S.instSearch.toLowerCase();
    let list = S.instances.filter((i) => (S.instFilter === "all" || i.loader === S.instFilter) && (!q || i.name.toLowerCase().includes(q) || i.version.includes(q)));
    list = S.instSort === "name" ? list.sort((a, b) => a.name.localeCompare(b.name)) : S.instSort === "version" ? list.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })) : S.instSort === "playtime" ? list.sort((a, b) => b.playtime - a.playtime) : sortedInstances(list);
    const grid = $("#instGrid", el);
    grid.innerHTML = list.map(instCard).join("") + `<button class="inst-card inst-new" data-new><div class="plus-big">${I.plus}</div><b>Nouvelle instance</b><span class="muted" style="font-size:12px">26.3, 26.2, 26.1, 1.21.11…</span></button>`;
    stagger(grid); bindCards(grid);
  };
  bindSeg(el, "instFilter", (v) => { S.instFilter = v; draw(); });
  $("#instSearch", el).oninput = (e) => { S.instSearch = e.target.value; draw(); };
  $("#instSort", el).onchange = (e) => { S.instSort = e.target.value; draw(); };
  $("#instNew", el).onclick = () => createModal();
  draw();
};

// ───────────────────────── Fenêtres modales ─────────────────────────
function modal(html, size = "") {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal ${size}">${html}</div>`;
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add("show"));
  const close = () => { ov.classList.remove("show"); setTimeout(() => ov.remove(), 350); document.removeEventListener("keydown", esc); m.onclose?.(); };
  const esc = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", esc);
  ov.addEventListener("mousedown", (e) => e.target === ov && close());
  $$("[data-close]", ov).forEach((b) => (b.onclick = close));
  const m = { el: ov, close, onclose: null };
  return m;
}

async function createModal(pre = {}) {
  const st = { engine: "java", step: 0, version: pre.version || "", loader: "vanilla", loaderVersion: "", name: "", icon: CUBE_NAMES[Math.floor(Math.random() * 6)], filter: pre.version ? "all" : "release", q: "", nameTouched: false };
  const m = modal(`
    <div class="modal-head"><div><div class="eyebrow">Nouvelle instance</div><h2 id="cmTitle">Choisis une version</h2></div><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body">
      <div class="step on" data-step="0">
        <div class="toolbar" style="margin-bottom:0">
          <div class="search" style="max-width:none">${I.search}<input class="input" id="cmSearch" placeholder="Rechercher : 26.3, 1.21.11, 25w41a…"></div>
          ${seg([["release", "Releases"], ["snapshot", "Snapshots"], ["old", "Anciennes"], ["all", "Toutes"]], st.filter, null, "cmFilter")}
          <button class="btn icon" id="cmRefresh" title="Actualiser la liste">${I.download}</button>
        </div>
        <div class="vlist" id="cmList"><div class="center"><div class="spinner"></div></div></div>
      </div>
      <div class="step" data-step="1">
        <div class="loader-cards five" id="cmLoaders">
          ${[["vanilla", "Vanilla", "Le jeu de Mojang.", "#4ade80", "V"], ["fabric", "Fabric", "Léger, mods modernes.", "#dbb88a", "F"], ["quilt", "Quilt", "Compatible Fabric.", "#c084fc", "Q"], ["forge", "Forge", "Le grand classique.", "#60a5fa", "Fo"], ["neoforge", "NeoForge", "Le Forge moderne.", "#f97316", "N"]].map(([id, n, d, c, l]) => `<button class="loader-card ${id === st.loader ? "on" : ""}" data-loader="${id}"><div class="li" style="background:${c}22;color:${c}">${l}</div><h4>${n}</h4><p>${d}</p></button>`).join("")}
        </div>
        <div id="cmEngine" style="display:none"><div class="label mt">Moteur</div><div class="engine-cards">
          <button class="loader-card on" data-eng="java"><div class="li" style="background:#4ade8022;color:#4ade80">☕</div><h4>Minecraft officiel</h4><p>Le jeu Java de Mojang, avec tous ses serveurs.</p></button>
          <button class="loader-card" data-eng="horizon"><div class="li" style="background:#f9731622;color:#f97316">🦀</div><h4>Horizon (Rust)</h4><p>Minecraft 26.3 réécrit en Rust. Compte Microsoft requis.</p></button></div></div>
        <div class="field mt" id="cmLvWrap" style="display:none"><label>Version du loader</label><select class="select" id="cmLv"></select><span class="hint" id="cmLvHint"></span></div>
      </div>
      <div class="step" data-step="2">
        <div class="preview-card" id="cmPreview"></div>
        <div class="field"><label>Nom</label><input class="input" id="cmName" maxlength="48"></div>
        <div class="field mt"><label>Icône</label><div class="icon-pick" id="cmIcons">${CUBE_NAMES.map((k) => `<button data-icon="${k}" class="${k === st.icon ? "on" : ""}" title="${k}">${cubeSVG(k, "")}</button>`).join("")}</div></div>
      </div>
    </div>
    <div class="modal-foot"><div class="steps" id="cmSteps"><i class="on"></i><i></i><i></i></div>
      <div class="flex"><button class="btn ghost" id="cmBack" style="visibility:hidden">Retour</button><button class="btn primary" id="cmNext" disabled>Continuer ${I.arrow}</button></div></div>`, "wide");
  const el = m.el;
  const titles = ["Choisis une version", "Choisis un loader", "Donne-lui un nom"];
  const defaultName = () => st.engine === "horizon" ? `Horizon ${st.version}` : `${LOADERS[st.loader] === "Vanilla" ? "Minecraft" : LOADERS[st.loader]} ${st.version}`;

  function setStep(n) {
    const back = n < st.step;
    st.step = n;
    $$(".step", el).forEach((s) => { s.classList.toggle("on", +s.dataset.step === n); s.classList.toggle("back", back); });
    $$("#cmSteps i", el).forEach((d, i) => d.classList.toggle("on", i <= n));
    $("#cmTitle", el).textContent = titles[n];
    $("#cmBack", el).style.visibility = n ? "visible" : "hidden";
    $("#cmNext", el).innerHTML = n === 2 ? `${I.check} Créer l'instance` : `Continuer ${I.arrow}`;
    if (n === 1) loadLoaderVersions();
    if (n === 2) {
      if (!st.nameTouched) $("#cmName", el).value = defaultName();
      preview(); setTimeout(() => $("#cmName", el).select(), 300);
    }
    validate(); Sound.nav();
  }
  function validate() {
    const ok = st.step === 0 ? !!st.version : st.step === 1 ? (st.loader === "vanilla" || st.loaderOk !== false) : !!$("#cmName", el).value.trim();
    $("#cmNext", el).disabled = !ok;
  }
  function preview() {
    $("#cmPreview", el).innerHTML = `${cubeSVG(st.icon, "")}<div><b>${h($("#cmName", el).value || defaultName())}</b><span class="muted">Minecraft ${h(st.version)} · ${LOADERS[st.loader]}${st.loaderVersion ? " " + h(st.loaderVersion) : ""}</span></div>`;
  }
  function drawList() {
    const list = $("#cmList", el);
    if (!S.manifest) return;
    const q = st.q.trim().toLowerCase();
    const items = S.manifest.versions.filter((v) => (st.filter === "all" || v.kind === st.filter || (st.filter === "old" && v.kind.startsWith("old"))) && (!q || v.id.toLowerCase().includes(q)));
    list.innerHTML = items.slice(0, 600).map((v) => `<button class="vrow ${v.id === st.version ? "on" : ""}" data-v="${h(v.id)}"><b>${h(v.id)}</b><span class="tag ${v.kind}">${KINDS[v.kind] || v.kind}</span>${v.id === S.manifest.latest_release ? `<span class="tag release">Dernière</span>` : ""}${S.installed.has(v.id) ? `<span class="inst">● téléchargée</span>` : ""}<span class="date">${fmtDate(v.released)}</span><span class="check">${I.check}</span></button>`).join("") || `<div class="empty">${I.search}Aucune version ne correspond.</div>`;
    $$(".vrow", list).forEach((r) => {
      r.onclick = () => { st.version = r.dataset.v; $$(".vrow", list).forEach((x) => x.classList.toggle("on", x === r)); Sound.tick(); validate(); };
      r.ondblclick = () => { st.version = r.dataset.v; setStep(1); };
    });
    const on = $(".vrow.on", list);
    if (on) on.scrollIntoView({ block: "center" });
  }
  async function loadLoaderVersions() {
    const wrap = $("#cmLvWrap", el), sel = $("#cmLv", el), hint = $("#cmLvHint", el);
    $("#cmEngine", el).style.display = st.loader === "vanilla" && st.version === HORIZON_VERSION ? "" : "none";
    if (st.loader !== "vanilla" || st.version !== HORIZON_VERSION) st.engine = "java";
    if (st.loader === "vanilla") { wrap.style.display = "none"; st.loaderOk = true; validate(); return; }
    wrap.style.display = ""; sel.innerHTML = `<option>Chargement…</option>`; sel.disabled = true; hint.textContent = ""; st.loaderOk = false; validate();
    try {
      const list = await invoke("loader_versions", { kind: st.loader, minecraft: st.version });
      sel.innerHTML = `<option value="">Dernière stable (${h((list.find((l) => l.stable) || list[0]).version)})</option>` + list.slice(0, 80).map((l) => `<option value="${h(l.version)}">${h(l.version)}${l.stable ? "" : " (bêta)"}</option>`).join("");
      sel.disabled = false; st.loaderOk = true; st.loaderVersion = "";
    } catch (e) { sel.innerHTML = `<option>Indisponible</option>`; hint.textContent = String(e); st.loaderOk = false; }
    validate();
  }
  bindSeg(el, "cmFilter", (v) => { st.filter = v; drawList(); });
  $("#cmSearch", el).oninput = (e) => { st.q = e.target.value; if (st.q && st.filter !== "all") { st.filter = "all"; $$('[data-seg="cmFilter"] button', el).forEach((b) => b.classList.toggle("on", b.dataset.v === "all")); bindSeg(el, "cmFilter", (v) => { st.filter = v; drawList(); }); } drawList(); };
  $("#cmRefresh", el).onclick = async () => { $("#cmList", el).innerHTML = `<div class="center"><div class="spinner"></div></div>`; try { await loadManifest(true); drawList(); } catch (e) { fail(e); } };
  $$("[data-loader]", el).forEach((b) => (b.onclick = () => { st.loader = b.dataset.loader; $$("[data-loader]", el).forEach((x) => x.classList.toggle("on", x === b)); Sound.tick(); loadLoaderVersions(); }));
  $("#cmLv", el).onchange = (e) => (st.loaderVersion = e.target.value);
  $$("[data-eng]", el).forEach((b) => (b.onclick = () => { st.engine = b.dataset.eng; $$("[data-eng]", el).forEach((x) => x.classList.toggle("on", x === b)); Sound.tick(); }));
  $("#cmName", el).oninput = () => { st.nameTouched = true; preview(); validate(); };
  $$("[data-icon]", el).forEach((b) => (b.onclick = () => { st.icon = b.dataset.icon; $$("[data-icon]", el).forEach((x) => x.classList.toggle("on", x === b)); preview(); Sound.tick(); }));
  $("#cmBack", el).onclick = () => setStep(st.step - 1);
  $("#cmNext", el).onclick = async () => {
    if (st.step < 2) return setStep(st.step + 1);
    try {
      const inst = await invoke("create_instance", { instance: { name: $("#cmName", el).value, version: st.version, loader: st.loader, loader_version: st.loaderVersion, icon: st.icon, engine: st.engine } });
      S.instances.push(inst);
      await saveSettings({ selected_instance: inst.id });
      m.close(); toast("Instance créée", `${inst.name} est prête. Les fichiers se téléchargent au premier lancement.`);
      go("home");
    } catch (e) { fail(e); }
  };
  try { await loadManifest(); drawList(); } catch (e) { $("#cmList", el).innerHTML = `<div class="empty">${I.alert}${h(e)}</div>`; }
  if (pre.version) validate();
}

// ───────────────────────── Panneau d'une instance ─────────────────────────
async function instanceDrawer(id) {
  const inst = { ...S.instances.find((i) => i.id === id) };
  if (!inst.id) return;
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.style.background = "rgba(2,5,4,.4)";
  const dr = document.createElement("aside");
  dr.className = "drawer";
  document.body.append(ov, dr);
  requestAnimationFrame(() => { ov.classList.add("show"); dr.classList.add("show"); });
  const close = () => { ov.classList.remove("show"); dr.classList.remove("show"); setTimeout(() => { ov.remove(); dr.remove(); }, 600); document.removeEventListener("keydown", esc); };
  const esc = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", esc);
  ov.onclick = close;
  let tab = "general";
  dr.innerHTML = `
    <div class="drawer-head">${cubeSVG(inst.icon)}<div class="grow"><div class="eyebrow">${h(LOADERS[inst.loader])} · ${h(inst.version)}</div><h2>${h(inst.name)}</h2></div><button class="btn ghost icon" id="drClose">${I.close}</button></div>
    <div class="tabs" id="drTabs"><span class="tab-line"></span><button data-tab="general" class="on">Général</button><button data-tab="content">Contenu</button><button data-tab="java">Java & mémoire</button><button data-tab="manage">Gérer</button></div>
    <div class="drawer-body" id="drBody"></div>
    <div class="drawer-foot"><button class="btn ghost" id="drCancel">Annuler</button><button class="btn primary" id="drSave">${I.check} Enregistrer</button></div>`;
  $("#drClose", dr).onclick = $("#drCancel", dr).onclick = close;
  const line = $(".tab-line", dr);
  const placeLine = () => { const on = $("#drTabs button.on", dr); line.style.width = on.offsetWidth + "px"; line.style.transform = `translateX(${on.offsetLeft}px)`; };
  $$("#drTabs button", dr).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; $$("#drTabs button", dr).forEach((x) => x.classList.toggle("on", x === b)); placeLine(); Sound.tick(); draw(); }));
  setTimeout(placeLine, 50);
  const body = $("#drBody", dr);
  async function draw() {
    if (tab === "general") {
      body.innerHTML = `<div class="stat-row"><div class="stat"><b>${fmtTime(inst.playtime)}</b><span>Temps de jeu</span></div><div class="stat"><b>${ago(inst.last_played)}</b><span>Dernière session</span></div><div class="stat"><b>${new Date(inst.created * 1000).toLocaleDateString("fr-FR")}</b><span>Créée le</span></div></div>
        <div class="field"><label>Nom</label><input class="input" data-k="name" value="${h(inst.name)}" maxlength="48"></div>
        <div class="grid-2"><div class="field"><label>Version de Minecraft</label><select class="select" data-k="version" id="drVersion"><option>${h(inst.version)}</option></select></div>
        <div class="field"><label>Loader</label><select class="select" data-k="loader"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></div></div>
        <div class="field"><label>Moteur</label><select class="select" data-k="engine"><option value="java">Minecraft officiel (Java)</option><option value="horizon">Horizon (Rust) — 26.3 Vanilla seulement</option></select></div>
        <div class="field"><label>Version du loader</label><input class="input" data-k="loader_version" value="${h(inst.loader_version)}" placeholder="Vide : la dernière stable"></div>
        <div class="field"><label>Rejoindre un serveur au lancement</label><input class="input" data-k="server" value="${h(inst.server)}" placeholder="play.monserveur.fr ou ip:port"></div>
        <div class="field"><label>Icône</label><div class="icon-pick" id="drIcons">${CUBE_NAMES.map((k) => `<button data-icon="${k}" class="${k === inst.icon ? "on" : ""}">${cubeSVG(k, "")}</button>`).join("")}</div></div>`;
      $("[data-k=loader]", body).value = inst.loader;
      $("[data-k=engine]", body).value = inst.engine || "java";
      $$("[data-icon]", body).forEach((b) => (b.onclick = () => { inst.icon = b.dataset.icon; $$("[data-icon]", body).forEach((x) => x.classList.toggle("on", x === b)); $(".drawer-head svg", dr).outerHTML = cubeSVG(inst.icon); Sound.tick(); }));
      loadManifest().then((mf) => {
        const sel = $("#drVersion", body);
        if (!sel) return;
        const opts = mf.versions.filter((v) => v.kind === "release" || (S.settings.show_snapshots && v.kind === "snapshot") || (S.settings.show_old && v.kind.startsWith("old")) || v.id === inst.version);
        sel.innerHTML = opts.map((v) => `<option value="${h(v.id)}">${h(v.id)}${v.kind !== "release" ? " · " + KINDS[v.kind] : ""}</option>`).join("");
        sel.value = inst.version;
      }).catch(() => {});
    } else if (tab === "content") {
      body.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
      try {
        const d = await invoke("instance_details", { id: inst.id });
        const block = (title, items, folder, icon) => `<div class="content-head"><b>${title} <span class="muted">(${items.length})</span></b><button class="btn small" data-folder="${folder}:${inst.id}">${I.folder} Ouvrir</button></div>
          <div class="content-list">${items.length ? items.slice(0, 40).map((n, i) => `<div style="--i:${i}">${icon}${h(n)}</div>`).join("") : `<span class="muted" style="font-size:12.5px">Rien pour l'instant.</span>`}</div>`;
        body.innerHTML = `<div class="stat-row"><div class="stat"><b>${fmtBytes(d.size)}</b><span>Sur le disque</span></div><div class="stat"><b>${d.worlds.length}</b><span>Mondes</span></div><div class="stat"><b>${d.screenshots}</b><span>Captures</span></div></div>
          ${block("Mondes", d.worlds, "saves", I.globe)}
          ${inst.loader !== "vanilla" ? block("Mods", d.mods, "mods", I.cube) : ""}
          ${block("Packs de ressources", d.resourcepacks, "resourcepacks", I.layers)}
          ${block("Shaders", d.shaderpacks, "shaderpacks", I.palette)}
          <div class="flex mt"><button class="btn small" data-folder="screenshots:${inst.id}">${I.folder} Captures d'écran</button><button class="btn small" data-folder="logs:${inst.id}">${I.file} Logs</button></div>`;
        bindCommon(body);
      } catch (e) { body.innerHTML = `<div class="empty">${h(e)}</div>`; }
    } else if (tab === "java") {
      const mem = inst.memory_mb || 0;
      body.innerHTML = `
        <div class="set-row" style="border:0;padding-top:0"><div class="txt"><b>Mémoire propre à cette instance</b><span>Sinon, celle des réglages généraux (${Math.round(S.settings.memory_mb / 102.4) / 10} Go).</span></div><button class="switch ${mem ? "on" : ""}" id="drMemOn"></button></div>
        <div id="drMemWrap" style="${mem ? "" : "opacity:.4;pointer-events:none"}">${memSlider("drMem", mem || S.settings.memory_mb)}</div>
        <div class="field mt"><label>Arguments JVM de l'instance</label><textarea class="input" data-k="jvm_args" placeholder="Vide : ceux des réglages généraux">${h(inst.jvm_args)}</textarea></div>
        <div class="grid-2"><div class="field"><label>Largeur de la fenêtre</label><input class="input" type="number" data-k="width" value="${inst.width || ""}" placeholder="${S.settings.width}"></div><div class="field"><label>Hauteur</label><input class="input" type="number" data-k="height" value="${inst.height || ""}" placeholder="${S.settings.height}"></div></div>`;
      bindMem(body, "drMem", (v) => (inst.memory_mb = v));
      $("#drMemOn", body).onclick = (e) => {
        const on = !e.currentTarget.classList.contains("on");
        e.currentTarget.classList.toggle("on", on);
        $("#drMemWrap", body).style.cssText = on ? "" : "opacity:.4;pointer-events:none";
        inst.memory_mb = on ? +$("#drMem", body).value : 0; Sound.tick();
      };
    } else {
      body.innerHTML = `
        <div class="set-card glass" style="padding:4px 18px">
          <div class="set-row" style="border:0"><div class="txt"><b>Réparer les fichiers</b><span>Revérifie chaque fichier (sha1) et retélécharge ceux qui sont abîmés, puis lance le jeu.</span></div><button class="btn" id="drRepair">${I.wrench} Réparer</button></div>
          <div class="set-row"><div class="txt"><b>Dupliquer</b><span>Une copie avec ses mondes, mods et réglages.</span></div><button class="btn" id="drDup">${I.copy} Dupliquer</button></div>
          <div class="set-row"><div class="txt"><b>Dossier de l'instance</b><span>Mondes, options.txt, mods, captures.</span></div><button class="btn" data-folder="instance:${inst.id}">${I.folder} Ouvrir</button></div>
          <div class="set-row"><div class="txt"><b style="color:var(--danger)">Supprimer l'instance</b><span>Retire l'instance du launcher. Ses mondes sont supprimés aussi si tu coches la case.</span>
            <label class="flex mt" style="font-size:12.5px;color:var(--text-2)"><input type="checkbox" id="drDelFiles"> Supprimer aussi ses fichiers (mondes compris)</label></div><button class="btn danger" id="drDel">${I.trash} Supprimer</button></div>
        </div>`;
      bindCommon(body);
      $("#drRepair", body).onclick = () => { close(); play(inst.id, true); };
      $("#drDup", body).onclick = async () => { try { const c = await invoke("duplicate_instance", { id: inst.id }); S.instances.push(c); toast("Instance dupliquée", c.name); close(); rerender(); } catch (e) { fail(e); } };
      $("#drDel", body).onclick = async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.sure) { b.dataset.sure = 1; b.innerHTML = `${I.alert} Confirmer`; return; }
        try {
          await invoke("delete_instance", { id: inst.id, removeFiles: $("#drDelFiles", body).checked });
          S.instances = S.instances.filter((i) => i.id !== inst.id);
          toast("Instance supprimée", inst.name); close(); rerender();
        } catch (err) { fail(err); }
      };
    }
    $$("[data-k]", body).forEach((f) => (f.oninput = f.onchange = () => {
      const k = f.dataset.k;
      inst[k] = f.type === "number" ? (+f.value || 0) : f.value;
    }));
  }
  $("#drSave", dr).onclick = async () => {
    try {
      await invoke("update_instance", { instance: inst });
      Object.assign(S.instances.find((i) => i.id === inst.id), inst);
      toast("Enregistré", inst.name); close(); rerender();
    } catch (e) { fail(e); }
  };
  draw();
}

// Curseur de mémoire, borné à la mémoire de l'ordinateur.
function memSlider(id, value) {
  const max = Math.max(4096, Math.floor(S.totalMem / 512) * 512);
  return `<div class="flex" style="justify-content:space-between;align-items:flex-end"><div class="mem-value" id="${id}Val"></div><span class="hint" id="${id}Hint"></span></div>
    <input type="range" class="range mt" id="${id}" min="1024" max="${max}" step="256" value="${Math.min(value, max)}">
    <div class="mem-scale"><span>1 Go</span><span>${Math.round(max / 2048)} Go</span><span>${Math.round(max / 1024)} Go (total)</span></div>`;
}
function bindMem(root, id, onChange) {
  const r = $("#" + id, root), val = $(`#${id}Val`, root), hint = $(`#${id}Hint`, root);
  const upd = () => {
    const v = +r.value, pct = ((v - r.min) / (r.max - r.min)) * 100;
    r.style.setProperty("--p", pct + "%");
    val.innerHTML = `${(v / 1024).toFixed(1).replace(".0", "")}<small>Go</small>`;
    const ratio = v / S.totalMem;
    hint.textContent = v < 2048 ? "Juste pour les petites versions" : ratio > .75 ? "⚠ Laisse de la mémoire au système" : v > 8192 ? "Gros modpacks" : "Recommandé";
    hint.style.color = ratio > .75 ? "var(--warn)" : "";
  };
  r.oninput = () => { upd(); onChange(+r.value); };
  upd();
}

// ───────────────────────── Nouveautés ─────────────────────────
function newsCard(n, i = 0, feature = false) {
  return `<button class="news-card ${feature ? "news-feature" : ""}" data-note="${i}"><div style="overflow:hidden"><div class="img" style="${n.image ? `background-image:url('${h(n.image)}')` : ""}"></div></div>
    <div class="body"><div class="flex"><span class="chip ${n.kind === "release" ? "accent" : ""}" style="height:22px">${h(KINDS[n.kind] || n.kind)}</span><span class="when">${fmtDate(n.date)}</span></div><h3>${h(n.title)}</h3><p>${h(n.short)}</p></div></button>`;
}
function bindNews(el) {
  $$("[data-note]", el).forEach((b) => (b.onclick = () => readNote(S.notes[+b.dataset.note])));
}
RENDER.news = async (el) => {
  el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Mojang</div><h1>Nouveautés</h1><p>Les notes de version de Minecraft: Java Edition, releases et snapshots.</p></div>
    ${seg([["all", "Tout"], ["release", "Releases"], ["snapshot", "Snapshots"]], "all", null, "newsFilter")}</div>
    <div class="news-grid" id="newsGrid">${Array.from({ length: 6 }, () => `<div class="skeleton" style="height:240px"></div>`).join("")}</div>`;
  const notes = await loadNotes();
  const draw = (f) => {
    const grid = $("#newsGrid", el);
    const items = notes.map((n, i) => [n, i]).filter(([n]) => f === "all" || n.kind === f);
    grid.innerHTML = items.map(([n, i], k) => newsCard(n, i, k === 0)).join("") || `<div class="empty">${I.globe}Pas de notes (hors ligne ?).</div>`;
    grid.setAttribute("data-stagger", ""); stagger(grid); bindNews(grid);
  };
  bindSeg(el, "newsFilter", draw);
  draw("all");
};
async function readNote(n) {
  const m = modal(`<div style="position:relative;height:240px;background:#0d1512 center/cover;${n.image ? `background-image:url('${h(n.image)}')` : ""}"><div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(14,22,19,1),transparent 70%)"></div>
    <button class="btn icon" data-close style="position:absolute;top:16px;right:16px;background:rgba(0,0,0,.4)">${I.close}</button>
    <div style="position:absolute;left:26px;bottom:14px"><span class="chip accent">${h(KINDS[n.kind] || n.kind)} ${h(n.version)}</span><h2 style="font:700 26px var(--display);margin-top:8px">${h(n.title)}</h2></div></div>
    <div class="modal-body article" id="noteBody"><div class="center"><div class="spinner"></div></div></div>
    <div class="modal-foot"><span class="muted">${fmtDate(n.date)}</span><button class="btn primary" id="noteCreate">${I.plus} Jouer en ${h(n.version)}</button></div>`, "wide");
  $("#noteCreate", m.el).onclick = () => { m.close(); createModal({ version: n.version }); };
  try {
    const html = await invoke("patch_note_body", { content: n.content });
    $("#noteBody", m.el).replaceChildren(sanitize(html));
  } catch (e) { $("#noteBody", m.el).innerHTML = `<p>${h(n.short)}</p><p class="muted">${h(e)}</p>`; }
}
// Le HTML des notes vient de Mojang : on ne garde que du texte mis en forme.
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "CODE", "BR", "A", "IMG", "BLOCKQUOTE"]);
  const out = document.createDocumentFragment();
  const walk = (node, parent) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { parent.append(c.textContent); continue; }
      if (c.nodeType !== 1) continue;
      if (!allowed.has(c.tagName)) { walk(c, parent); continue; }
      const e = document.createElement(c.tagName);
      if (c.tagName === "A") { const href = c.getAttribute("href") || ""; if (href.startsWith("https://")) e.onclick = () => invoke("open_url", { url: href }).catch(fail); }
      if (c.tagName === "IMG") { const src = c.getAttribute("src") || ""; if (/^https:\/\//.test(src)) e.src = src; else if (src.startsWith("/")) e.src = "https://launchercontent.mojang.com" + src; else continue; }
      parent.append(e); walk(c, e);
    }
  };
  walk(doc.body, out);
  return out;
}

// ───────────────────────── Console ─────────────────────────
RENDER.console = async (el) => {
  const withLogs = S.instances.filter((i) => S.logs[i.id]?.length || S.running.has(i.id) || S.preparing === i.id);
  if (!S.consoleId || !S.instances.find((i) => i.id === S.consoleId)) S.consoleId = (withLogs[0] || selected())?.id;
  const opts = S.instances.map((i) => `<option value="${i.id}">${h(i.name)}${S.running.has(i.id) ? " ● en jeu" : ""}</option>`).join("");
  el.innerHTML = `<div class="page-head" style="margin-bottom:14px"><div><div class="eyebrow">Logs du jeu</div><h1>Console</h1></div>
    <div class="flex"><select class="select" id="conInst" style="width:220px">${opts}</select>
    <div class="search" style="min-width:180px">${I.search}<input class="input" id="conFilter" placeholder="Filtrer…"></div>
    <button class="btn icon" id="conCopy" title="Copier">${I.copy}</button><button class="btn" id="conAuto">Défilement auto</button></div></div>
    <div class="console-wrap"><div class="console" id="con"></div></div>`;
  if (S.consoleId) $("#conInst", el).value = S.consoleId;
  let auto = true;
  const btnAuto = $("#conAuto", el);
  btnAuto.classList.add("primary");
  btnAuto.onclick = () => { auto = !auto; btnAuto.classList.toggle("primary", auto); };
  const con = $("#con", el);
  const draw = async () => {
    if (!S.consoleId) { con.innerHTML = `<div class="console-empty"><div>${I.file}<br>Lance une instance pour voir ses logs ici.</div></div>`; return; }
    try { S.logs[S.consoleId] = await invoke("game_logs", { id: S.consoleId }); } catch { /* garde ce qu'on a */ }
    const f = $("#conFilter", el).value.toLowerCase();
    const lines = (S.logs[S.consoleId] || []).filter((l) => !f || l.toLowerCase().includes(f));
    con.innerHTML = lines.length ? lines.slice(-2500).map(logLine).join("") : `<div class="console-empty"><div>${I.file}<br>Pas encore de logs pour cette instance.</div></div>`;
    con.scrollTop = con.scrollHeight;
  };
  $("#conInst", el).onchange = (e) => { S.consoleId = e.target.value; draw(); };
  $("#conFilter", el).oninput = draw;
  $("#conCopy", el).onclick = () => { navigator.clipboard.writeText((S.logs[S.consoleId] || []).join("\n")); toast("Logs copiés"); };
  RENDER.console.append = (id, line) => {
    if (S.page !== "console" || id !== S.consoleId) return;
    const f = $("#conFilter", el).value.toLowerCase();
    if (f && !line.toLowerCase().includes(f)) return;
    if ($(".console-empty", con)) con.innerHTML = "";
    con.insertAdjacentHTML("beforeend", logLine(line));
    if (con.childElementCount > 3000) con.firstElementChild.remove();
    if (auto) con.scrollTop = con.scrollHeight;
  };
  draw();
};
function logLine(l) {
  const cls = l.startsWith("[Leaf]") ? "leaf" : /\b(ERROR|FATAL|Exception|SEVERE)\b/.test(l) ? "err" : /\bWARN/.test(l) ? "warn" : /\bDEBUG\b/.test(l) ? "dim" : "";
  return `<div class="l ${cls}">${h(l)}</div>`;
}

// ───────────────────────── Comptes ─────────────────────────
RENDER.accounts = (el) => {
  const active = S.settings.active_account;
  el.innerHTML = `<div data-stagger><div class="page-head"><div><div class="eyebrow">Profils</div><h1>Comptes</h1><p>Le compte actif est celui avec lequel tu joues.</p></div></div>
    <div class="acc-grid" id="accList" data-stagger>${S.accounts.length ? S.accounts.map((a) => `
      <div class="acc-card glass ${a.uuid === active ? "on" : ""}"><img src="${headUrl(a, 128)}" alt="" data-fallback="hide">
        <div class="who"><b>${h(a.name)}</b><span>${a.kind === "microsoft" ? "Compte Microsoft" : "Hors ligne"} · ${h(a.uuid.slice(0, 8))}…</span></div>
        ${a.uuid === active ? `<span class="chip accent"><i></i>Actif</span>` : `<button class="btn small" data-use="${a.uuid}">Utiliser</button>`}
        <button class="btn small icon ghost" data-del="${a.uuid}" title="Retirer">${I.trash}</button></div>`).join("") : `<div class="glass empty" style="grid-column:1/-1">${I.user}Aucun compte pour l'instant.</div>`}</div>
    <div class="section-title"><h2>Ajouter un compte</h2></div>
    <div class="acc-add">
      <div class="acc-option glass"><div class="ico">${I.ms}</div><h3>Compte Microsoft</h3><p>Pour jouer en ligne, sur les serveurs officiels et avec ton skin. Il faut posséder Minecraft: Java Edition.</p><button class="btn primary" id="msWeb">${I.ms} Se connecter avec Microsoft</button><button class="link" id="msAdd">Pas de navigateur sur ce PC ? Se connecter avec un code ${I.arrow}</button></div>
      <div class="acc-option glass"><div class="ico">${I.user}</div><h3>Hors ligne</h3><p>Un simple pseudo, pour le solo et les serveurs en mode hors ligne.</p>
        <div class="inline"><input class="input" id="offName" placeholder="Pseudo (3 à 16 caractères)" maxlength="16"><button class="btn" id="offAdd">Ajouter</button></div></div>
    </div></div>`;
  $$("[data-use]", el).forEach((b) => (b.onclick = async () => { try { await invoke("select_account", { uuid: b.dataset.use }); S.settings.active_account = b.dataset.use; renderAccountBtn(); rerender(); Sound.ok(); } catch (e) { fail(e); } }));
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.classList.add("danger"); b.title = "Cliquer encore pour retirer"; return; }
    try { await invoke("remove_account", { uuid: b.dataset.del }); await refresh(); rerender(); toast("Compte retiré"); } catch (e) { fail(e); }
  }));
  const addOff = async () => {
    try { const a = await invoke("add_offline", { name: $("#offName", el).value }); await refresh(); rerender(); toast("Compte ajouté", `${a.name} (hors ligne)`); } catch (e) { fail(e); }
  };
  $("#offAdd", el).onclick = addOff;
  $("#offName", el).onkeydown = (e) => e.key === "Enter" && addOff();
  $("#msAdd", el).onclick = msLogin;
  $("#msWeb", el).onclick = msBrowserLogin;
};
async function msLogin() {
  if (!S.msaBuiltin && !S.settings.ms_client_id) {
    toast("Connexion Microsoft indisponible", "Cette version a été compilée sans application Microsoft. Télécharge la version publiée sur GitHub.", "error", 8000);
    return;
  }
  const m = modal(`<div class="modal-head"><h2>Connexion Microsoft</h2><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body" id="msBody"><div class="center"><div class="spinner"></div></div></div>`, "narrow");
  m.onclose = () => invoke("ms_cancel");
  try {
    const code = await invoke("ms_start");
    $("#msBody", m.el).innerHTML = `<p style="color:var(--text-2)">Ouvre <b style="color:var(--text)">${h(code.verification_uri)}</b> et saisis ce code :</p>
      <div class="code-box">${[...code.user_code].map((c, i) => c === "-" ? `<span class="dash">–</span>` : `<span style="--i:${i}">${h(c)}</span>`).join("")}</div>
      <div class="flex" style="justify-content:center"><button class="btn" id="msCopy">${I.copy} Copier</button><button class="btn primary" id="msOpen">${I.globe} Ouvrir la page</button></div>
      <div class="flex mt" style="justify-content:center;color:var(--text-3);font-size:12.5px"><div class="spinner" style="width:14px;height:14px;border-width:2px"></div>En attente de la connexion…</div>`;
    $("#msCopy", m.el).onclick = () => { navigator.clipboard.writeText(code.user_code); toast("Code copié"); };
    $("#msOpen", m.el).onclick = () => { navigator.clipboard.writeText(code.user_code); invoke("open_url", { url: code.verification_uri }).catch(fail); };
    const acc = await invoke("ms_finish", { code });
    m.onclose = null; m.close();
    await refresh(); if (S.page === "accounts") rerender();
    toast("Connecté", `Bienvenue, ${acc.name} !`);
  } catch (e) {
    if (!String(e).includes("annulée")) { m.onclose = null; m.close(); fail(e); }
  }
}

// ───────────────────────── Réglages ─────────────────────────
const ACCENTS = [["leaf", "#4ade80"], ["ocean", "#38bdf8"], ["amethyst", "#a78bfa"], ["ember", "#fb923c"], ["sakura", "#f472b6"], ["gold", "#facc15"], ["frost", "#e2e8f0"]];
RENDER.settings = async (el, opts = {}) => {
  const s = S.settings;
  const tog = (k, title, desc) => `<div class="set-row"><div class="txt"><b>${title}</b><span>${desc}</span></div><button class="switch ${s[k] ? "on" : ""}" data-toggle="${k}"></button></div>`;
  const sections = [["game", "Jeu", I.cube], ["java", "Java & mémoire", I.memory], ["launch", "Lancement", I.rocket], ["look", "Apparence", I.palette], ["versions", "Versions", I.layers], ["net", "Téléchargements", I.download], ["accounts", "Comptes", I.user], ["discord", "Discord", I.discord], ["horizon", "Horizon (Rust)", I.rust], ["storage", "Stockage", I.disk], ["about", "À propos", I.info]];
  el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Préférences</div><h1>Réglages</h1></div></div>
  <div class="settings-layout"><nav class="settings-nav">${sections.map(([id, n, ic], i) => `<button data-sec="${id}" class="${i ? "" : "on"}">${ic}${n}</button>`).join("")}</nav>
  <div data-stagger>
    <div class="set-card glass" id="sec-game"><h3>${I.cube} Jeu</h3>
      <div class="set-row"><div class="txt"><b>Résolution de la fenêtre</b><span>La taille de la fenêtre du jeu au lancement.</span></div><div class="ctl"><input class="input" type="number" data-num="width" value="${s.width}" style="width:100px"><span class="muted">×</span><input class="input" type="number" data-num="height" value="${s.height}" style="width:100px"></div></div>
      ${tog("fullscreen", "Plein écran", "Lance le jeu directement en plein écran.")}
    </div>
    <div class="set-card glass" id="sec-java"><h3>${I.memory} Java & mémoire</h3>
      <div class="set-row col"><div class="txt"><b>Mémoire allouée</b><span>${Math.round(S.totalMem / 1024)} Go dans cet ordinateur. 4 à 6 Go suffisent en Vanilla ; 6 à 10 Go pour les gros modpacks.</span></div>${memSlider("setMem", s.memory_mb)}</div>
      <div class="set-row"><div class="txt"><b>Mémoire de départ (-Xms)</b><span>0 : laisser Java décider.</span></div><div class="ctl"><input class="input" type="number" data-num="min_memory_mb" value="${s.min_memory_mb}" step="256" style="width:120px"><span class="muted">Mo</span></div></div>
      <div class="set-row col"><div class="txt"><b>Java</b><span>Vide : le launcher télécharge le Java de Mojang qui convient à chaque version (8, 17, 21, 25…).</span></div><input class="input" data-text="java_path" value="${h(s.java_path)}" placeholder="Automatique (recommandé) — ou C:\\…\\bin\\java.exe"></div>
      <div class="set-row col"><div class="txt"><b>Arguments JVM</b><span>Pour toutes les instances qui n'ont pas les leurs.</span></div><textarea class="input" data-text="jvm_args">${h(s.jvm_args)}</textarea>
        <div class="flex"><button class="btn small" data-preset="-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200">G1GC (défaut)</button><button class="btn small" data-preset="-XX:+UnlockExperimentalVMOptions -XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch">ZGC générationnel</button><button class="btn small" data-preset="-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15">Aikar (modpacks)</button></div></div>
    </div>
    <div class="set-card glass" id="sec-launch"><h3>${I.rocket} Lancement</h3>
      <div class="set-row"><div class="txt"><b>Après le lancement</b><span>Ce que fait le launcher quand le jeu démarre.</span></div>${seg([["keep", "Rester ouvert"], ["minimize", "Réduire"], ["hide", "Cacher"], ["close", "Fermer"]], s.after_launch, null, "after")}</div>
      ${tog("open_console", "Ouvrir la console au lancement", "Affiche les logs du jeu pendant qu'il démarre.")}
      ${tog("verify_on_launch", "Vérifier les fichiers à chaque lancement", "Contrôle le sha1 de chaque fichier. Plus sûr, mais le lancement est plus lent.")}
    </div>
    <div class="set-card glass" id="sec-look"><h3>${I.palette} Apparence</h3>
      <div class="set-row"><div class="txt"><b>Couleur d'accent</b><span>Un clic ici, ou toutes les couleurs dans l'éditeur de thème.</span></div><div class="swatches">${ACCENTS.map(([k, c]) => `<button class="swatch ${(S.settings.theme?.accent || "#4ade80") === c ? "on" : ""}" data-accent="${k}" data-hexc="${c}" style="--sw:${c}" title="${k}"></button>`).join("")}</div></div>
      <div class="set-row"><div class="txt"><b>Éditeur de thème</b><span>Préréglages, fond (aurore, dégradé, image), particules, polices, arrondis, taille de l'interface…</span></div><button class="btn primary" id="openTheme">${I.palette} Personnaliser</button></div>
      ${tog("animations", "Animations", "Transitions, effets de survol et motion design. Désactive-les sur un PC modeste.")}
      ${tog("particles", "Particules", "Les petits pixels qui flottent dans le fond.")}
      ${tog("glass", "Effet verre", "Le flou derrière les panneaux.")}
      ${tog("sounds", "Sons d'interface", "De petits sons discrets au clic et au lancement.")}
    </div>
    <div class="set-card glass" id="sec-versions"><h3>${I.layers} Versions</h3>
      ${tog("show_snapshots", "Snapshots dans les réglages d'instance", "Les versions de test hebdomadaires de Mojang.")}
      ${tog("show_old", "Anciennes versions", "Bêta et Alpha (2009-2011).")}
      <div class="set-row"><div class="txt"><b>Liste des versions</b><span>Recharge la liste depuis Mojang.</span></div><button class="btn" id="setRefreshV">${I.download} Actualiser</button></div>
    </div>
    <div class="set-card glass" id="sec-net"><h3>${I.download} Téléchargements</h3>
      <div class="set-row col"><div class="txt"><b>Téléchargements en parallèle</b><span>Plus, c'est plus rapide sur une bonne connexion.</span></div>
        <div class="flex"><input type="range" class="range" id="setJobs" min="1" max="64" value="${s.download_jobs}"><b id="setJobsV" style="width:30px;text-align:right">${s.download_jobs}</b></div></div>
    </div>
    <div class="set-card glass" id="sec-accounts"><h3>${I.user} Comptes</h3>
      <div class="set-row col"><div class="txt"><b>Application Microsoft (avancé, optionnel)</b><span>${S.msaBuiltin ? "La connexion Microsoft est intégrée à cette version : rien à régler." : "Cette version n'a pas de connexion Microsoft intégrée."} Pour utiliser ta propre application Azure, colle son client ID ici ; sinon laisse vide.</span></div>
        <input class="input" data-text="ms_client_id" value="${h(s.ms_client_id)}" placeholder="00000000-0000-0000-0000-000000000000"></div>
    </div>
    ${discordSection(s)}
    ${horizonSection()}
    <div class="set-card glass" id="sec-storage"><h3>${I.disk} Stockage</h3>
      <div class="set-row col"><div class="storage-bar" id="stBar"><i style="background:var(--accent)"></i><i style="background:#38bdf8"></i><i style="background:#a78bfa"></i><i style="background:#f97316"></i></div><div class="legend" id="stLegend"><span class="muted">Calcul…</span></div></div>
      <div class="set-row"><div class="txt"><b>Dossier du launcher</b><span style="user-select:text">${h(S.dataDir)}</span></div><button class="btn" data-folder="data">${I.folder} Ouvrir</button></div>
    </div>
    <div class="set-card glass" id="sec-about"><h3>${I.info} À propos</h3>
      <div style="padding:10px 0 4px"><img src="logo.png" alt="LeafLauncher" style="height:44px"></div>
      <div class="set-row"><div class="txt"><b>Leaf Launcher ${h(S.version)}</b><span>Un launcher Minecraft: Java Edition open source en Rust (Tauri), bâti sur la base du launcher Horizon (MIT). Pas un produit officiel Minecraft, ni approuvé par Mojang ou Microsoft.</span></div><div class="ctl"><button class="btn" id="setLicenses">${I.file} Licences open source</button><button class="btn" id="setGithub">${I.globe} GitHub</button><button class="btn ghost" id="setHorizon">Horizon</button></div></div>
    </div>
  </div></div>`;
  // Interrupteurs, champs, segments.
  $$("[data-toggle]", el).forEach((b) => (b.onclick = () => { const k = b.dataset.toggle; const v = !s[k]; b.classList.toggle("on", v); Sound.tick(); saveSettings({ [k]: v }); }));
  $$("[data-num]", el).forEach((f) => (f.onchange = () => saveSettings({ [f.dataset.num]: Math.max(0, +f.value || 0) })));
  $$("[data-text]", el).forEach((f) => (f.onchange = () => saveSettings({ [f.dataset.text]: f.value.trim() })));
  $$("[data-preset]", el).forEach((b) => (b.onclick = () => { const t = $("[data-text=jvm_args]", el); t.value = b.dataset.preset; saveSettings({ jvm_args: t.value }); toast("Arguments JVM appliqués", b.textContent); }));
  $$("[data-accent]", el).forEach((b) => (b.onclick = () => { $$("[data-accent]", el).forEach((x) => x.classList.toggle("on", x === b)); Sound.tick(); setTheme({ accent: b.dataset.hexc, preset: "" }); }));
  $("#openTheme", el).onclick = () => go("theme");
  bindSeg(el, "after", (v) => saveSettings({ after_launch: v }));
  let memTimer;
  bindMem(el, "setMem", (v) => { clearTimeout(memTimer); memTimer = setTimeout(() => saveSettings({ memory_mb: v }), 300); });
  const jobs = $("#setJobs", el), jobsV = $("#setJobsV", el);
  const jp = () => jobs.style.setProperty("--p", ((jobs.value - 1) / 63) * 100 + "%");
  jp(); jobs.oninput = () => { jobsV.textContent = jobs.value; jp(); }; jobs.onchange = () => saveSettings({ download_jobs: +jobs.value });
  $("#setRefreshV", el).onclick = async () => { try { await loadManifest(true); toast("Liste à jour", `${S.manifest.versions.length} versions, dernière : ${S.manifest.latest_release}`); } catch (e) { fail(e); } };
  $("#setHorizon", el).onclick = () => invoke("open_url", { url: "https://github.com/horizon-rust/horizon" }).catch(fail);
  $("#setGithub", el).onclick = () => invoke("open_url", { url: "https://github.com/loxans2/LeafLauncher" }).catch(fail);
  $("#setLicenses", el).onclick = openLicenses;
  bindCommon(el);
  bindDiscordSection(el);
  bindHorizonSection(el);
  // Navigation interne et section suivie au défilement.
  const navBtns = $$("[data-sec]", el);
  navBtns.forEach((b) => (b.onclick = () => $(`#sec-${b.dataset.sec}`, el).scrollIntoView({ behavior: S.settings.animations === false ? "auto" : "smooth", block: "start" })));
  el.onscroll = () => {
    let cur = "game";
    for (const b of navBtns) if ($(`#sec-${b.dataset.sec}`, el).offsetTop - el.scrollTop < 140) cur = b.dataset.sec;
    navBtns.forEach((b) => b.classList.toggle("on", b.dataset.sec === cur));
  };
  if (opts.section) setTimeout(() => $(`#sec-${opts.section}`, el)?.scrollIntoView({ block: "start" }), 350);
  // Stockage.
  invoke("storage").then((st) => {
    const total = st.minecraft + st.runtime + st.instances + (st.horizon || 0) || 1;
    const bars = $("#stBar i", el);
    setTimeout(() => [st.minecraft, st.runtime, st.instances, st.horizon || 0].forEach((v, i) => bars[i] && (bars[i].style.width = (v / total) * 100 + "%")), 100);
    $("#stLegend", el).innerHTML = `<span><i style="background:var(--accent)"></i>Jeu et ressources · ${fmtBytes(st.minecraft)}</span><span><i style="background:#38bdf8"></i>Java · ${fmtBytes(st.runtime)}</span><span><i style="background:#a78bfa"></i>Instances · ${fmtBytes(st.instances)}</span><span><i style="background:#f97316"></i>Horizon · ${fmtBytes(st.horizon || 0)}</span>`;
  }).catch(() => {});
};

// ───────────────────────── Événements du backend ─────────────────────────
listen("launch-progress", ({ payload: p }) => {
  S.progress = p; S.preparing = p.id;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  showTask(true, `${p.stage} · ${pct} %`, pct);
  updatePlayButtons();
});
listen("launch-error", ({ payload: p }) => {
  S.preparing = null; S.progress = null; showTask(false); updatePlayButtons();
  fail(p.error);
});
listen("game-started", ({ payload: p }) => {
  S.preparing = null; S.progress = null; S.running.add(p.id); showTask(false);
  const inst = S.instances.find((i) => i.id === p.id);
  if (inst) inst.last_played = Math.floor(Date.now() / 1000);
  updatePlayButtons();
  toast("Bon jeu !", `${inst?.name || "Minecraft"} démarre.`);
});
listen("game-exit", ({ payload: p }) => {
  S.running.delete(p.id);
  const inst = S.instances.find((i) => i.id === p.id);
  if (inst) inst.playtime += p.played || 0;
  updatePlayButtons();
  if (p.code && p.code !== 0) toast("Le jeu s'est arrêté", `Code de sortie ${p.code}. Regarde la console pour comprendre.`, "error", 9000);
  else toast("Session terminée", `${fmtTime(p.played)} de jeu sur ${inst?.name || "Minecraft"}.`);
  if (S.page === "home") rerender();
});
listen("game-log", ({ payload: p }) => {
  (S.logs[p.id] ||= []).push(p.line);
  if (S.logs[p.id].length > 5000) S.logs[p.id].shift();
  RENDER.console.append?.(p.id, p.line);
});

// Raccourcis : Ctrl+1…6 pour les pages, Ctrl+N nouvelle instance, Entrée pour jouer.
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || $(".overlay")) return;
  const pages = ["home", "instances", "library", "news", "console", "theme", "accounts", "settings"];
  if (e.ctrlKey && e.key >= "1" && e.key <= "8") { e.preventDefault(); go(pages[+e.key - 1]); }
  if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); createModal(); }
  if (e.key === "Enter" && S.page === "home" && selected()) play(selected().id);
});
addEventListener("resize", moveIndicator);
// Une image qui ne charge pas (pas de connexion) : un pictogramme, ou rien.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fallback === "user") { const d = document.createElement("div"); d.className = "ph"; d.innerHTML = I.user; img.replaceWith(d); }
  else if (img.dataset.fallback === "hide") img.style.visibility = "hidden";
}, true);

// ───────────────────────── Démarrage ─────────────────────────
(async function init() {
  const t0 = performance.now();
  try { await refresh(); } catch (e) { console.error(e); }
  loadNotes();
  go("home");
  await sleep(Math.max(0, 1500 - (performance.now() - t0)));
  $("#splash").classList.add("done");
  if (S.preparing) showTask(true);
})();

// ───────────────────────── Aperçu sans Tauri (navigateur) ─────────────────────────
function mockInvoke(cmd, args) {
  const now = Math.floor(Date.now() / 1000);
  const mk = (id, kind, d) => ({ id, kind, released: d });
  const data = {
    bootstrap: {
      settings: { memory_mb: 6144, min_memory_mb: 0, java_path: "", jvm_args: "-XX:+UseG1GC", width: 1280, height: 720, fullscreen: false, after_launch: "minimize", open_console: false, download_jobs: 16, verify_on_launch: false, accent: "leaf", animations: true, particles: true, glass: true, background: "aurora", show_snapshots: false, show_old: false, ms_client_id: "", selected_instance: "a1", active_account: "u1", sounds: false },
      accounts: [{ kind: "offline", name: "Steve", uuid: "u1" }],
      instances: [
        { id: "a1", name: "Survie 26.3", version: "26.3", loader: "fabric", icon: "grass", memory_mb: 0, playtime: 45200, last_played: now - 7200, created: now - 864000, favorite: true },
        { id: "a2", name: "Créatif", version: "26.2", loader: "vanilla", icon: "diamond", playtime: 8000, last_played: now - 86400 * 3, created: now - 86400 * 20 },
        { id: "a3", name: "Modpack Tech", version: "1.21.11", loader: "quilt", icon: "redstone", playtime: 120000, last_played: now - 86400 * 9, created: now - 86400 * 60 },
        { id: "a4", name: "Hardcore", version: "26.1", loader: "vanilla", icon: "nether", playtime: 3600, last_played: 0, created: now - 86400 },
      ],
      running: [], preparing: null, installed: ["26.3", "1.21.11"], data_dir: "C:\\Users\\Joueur\\AppData\\Roaming\\LeafLauncher", total_memory_mb: 32768, version: "1.0.0",
    },
    list_versions: { latest_release: "26.3", latest_snapshot: "26.4-snapshot-1", offline: false, versions: [mk("26.4-snapshot-1", "snapshot", "2026-10-28"), mk("26.3", "release", "2026-09-30"), mk("26.2", "release", "2026-06-16"), mk("26.1", "release", "2026-03-24"), mk("1.21.11", "release", "2025-12-09"), mk("1.21.10", "release", "2025-10-07"), mk("1.20.1", "release", "2023-06-12"), mk("b1.7.3", "old_beta", "2011-07-08")] },
    patch_notes: [], loader_versions: [{ version: "0.17.3", stable: true }, { version: "0.17.2", stable: true }],
    instance_details: { worlds: ["Nouveau monde", "Île"], mods: ["sodium.jar", "lithium.jar"], resourcepacks: [], shaderpacks: [], screenshots: 12, size: 734003200 },
    storage: { minecraft: 1.2e9, runtime: 3.1e8, instances: 7.4e8, horizon: 9e8 }, game_logs: [],
    modrinth_installed: { AANobbMI: { file: "sodium.jar", kind: "mod", title: "Sodium", version: "0.7.0" } },
    modrinth_search: { total_hits: 2, hits: [{ project_id: "AANobbMI", slug: "sodium", title: "Sodium", author: "jellysquid3", description: "Un moteur de rendu moderne qui améliore énormément les FPS.", downloads: 98200000, follows: 30000, icon_url: "", project_type: "mod", categories: ["optimization"] }, { project_id: "gvQqBUqZ", slug: "lithium", title: "Lithium", author: "jellysquid3", description: "Optimise la physique, l'IA des mobs et le chargement des chunks.", downloads: 51000000, follows: 12000, icon_url: "", project_type: "mod", categories: ["optimization"] }] },
  };
  if (cmd === "bootstrap") data.bootstrap.horizon = { installed: true, name: "Nightly 2026-10-31", prepared: false };
  return new Promise((res) => setTimeout(() => res(structuredClone(data[cmd] ?? null)), 120));
}
