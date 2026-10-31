"use strict";
/* Leaf Launcher — musique en cours (contrôles multimédias de Windows), fonds vidéo et son, intro
   au lancement, Pack Leaf Client. Chargé après features.js. */

// ───────────────────────── Musique en cours ─────────────────────────
const NP = { info: null, cover: "", key: "", app: "", timer: 0, tick: 0, open: false };
const fmtMs = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const playerOn = () => theme().player !== false;

async function pollMusic() {
  clearTimeout(NP.timer);
  if (!playerOn() || document.hidden) { NP.timer = setTimeout(pollMusic, 2500); return renderMusic(); }
  try {
    const info = await invoke("now_playing", { app: NP.app, known: NP.key });
    if (info && info.cover) NP.cover = info.cover;
    if (info && info.key && info.key !== NP.key && !info.cover) NP.cover = "";
    if (info && info.key) NP.key = info.key;
    NP.info = info; NP.at = Date.now();
  } catch { NP.info = null; }
  renderMusic();
  NP.timer = setTimeout(pollMusic, 1500);
}
// La barre de progression avance entre deux lectures.
setInterval(() => {
  const i = NP.info;
  if (!i || !i.active) return;
  const pos = i.playing ? Math.min(i.duration || 0, i.position + (Date.now() - (NP.at || Date.now()))) : i.position;
  const pct = i.duration ? (pos / i.duration) * 100 : 0;
  $$(".np-bar i").forEach((b) => (b.style.width = pct + "%"));
  $$(".np-time").forEach((t) => (t.textContent = `${fmtMs(pos)} / ${fmtMs(i.duration)}`));
}, 250);

const NP_ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5.5v13a1 1 0 0 1-1.5.86L9 13.7a2 2 0 0 1 0-3.4l9.5-5.66A1 1 0 0 1 20 5.5z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5.5v13a1 1 0 0 0 1.5.86L15 13.7a2 2 0 0 0 0-3.4L5.5 4.64A1 1 0 0 0 4 5.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
};
function coverHtml(cls = "np-cover") {
  return NP.cover ? `<img class="${cls}" src="${NP.cover}" alt="">` : `<div class="${cls} empty">${NP_ICONS.note}</div>`;
}
function controlsHtml() {
  const i = NP.info || {};
  return `<div class="np-ctl"><button data-np="previous" title="Précédent">${NP_ICONS.prev}</button><button class="main" data-np="toggle" title="Lecture / pause">${i.playing ? NP_ICONS.pause : NP_ICONS.play}</button><button data-np="next" title="Suivant">${NP_ICONS.next}</button></div>`;
}
function bindNp(root) {
  $$("[data-np]", root).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation(); Sound.tick();
    b.classList.add("pressed"); setTimeout(() => b.classList.remove("pressed"), 250);
    try { await invoke("media_control", { app: NP.info?.app || NP.app, action: b.dataset.np }); setTimeout(pollMusic, 250); } catch (err) { fail(err); }
  }));
}
function renderMusic() {
  const i = NP.info, mini = $("#npMini");
  const active = playerOn() && i && i.active;
  mini.hidden = !active;
  if (active) {
    mini.innerHTML = `${coverHtml("np-cover sm")}<div class="np-mini-txt"><b>${h(i.title)}</b><span>${h(i.artist || i.app_name)}</span></div>${controlsHtml()}`;
    mini.classList.toggle("playing", i.playing);
    bindNp(mini);
    mini.onclick = () => openMusicPanel();
  }
  const card = $("#npCard");
  if (card) {
    card.hidden = !active;
    if (active) {
      card.innerHTML = `<div class="np-bg" style="${NP.cover ? `background-image:url('${NP.cover}')` : ""}"></div>
        ${coverHtml("np-cover lg")}<div class="np-info"><div class="eyebrow">${i.playing ? "En écoute" : "En pause"} · ${h(i.app_name)}</div>
        <h3>${h(i.title)}</h3><p>${h(i.artist)}${i.album && i.album !== i.app_name ? ` · ${h(i.album)}` : ""}</p>
        <div class="np-bar"><i></i></div><div class="np-row"><span class="np-time"></span>${controlsHtml()}</div></div>
        <div class="np-eq ${i.playing ? "on" : ""}"><i></i><i></i><i></i><i></i></div>`;
      bindNp(card);
    }
  }
  const panel = $("#npPanelBody");
  if (panel && i) drawPanel(panel);
}
function drawPanel(body) {
  const i = NP.info || {};
  const apps = i.apps || [];
  body.innerHTML = i.active ? `<div class="np-panel-top">${coverHtml("np-cover xl")}<div><div class="eyebrow">${h(i.app_name)}</div><h2>${h(i.title)}</h2><p class="muted">${h(i.artist)}</p></div></div>
      <div class="np-bar big"><i></i></div><div class="np-row"><span class="np-time"></span>${controlsHtml()}</div>`
    : `<div class="empty">${NP_ICONS.note}Aucune musique en cours. Lance Spotify, Liner, Deezer, YouTube…</div>`;
  if (apps.length > 1) body.innerHTML += `<div class="label mt">Contrôler</div><div class="font-pick mt">${apps.map((a) => `<button data-npapp="${h(a.id)}" class="${a.id === (i.app || NP.app) ? "on" : ""}">${h(a.name)}</button>`).join("")}</div>`;
  bindNp(body);
  $$("[data-npapp]", body).forEach((b) => (b.onclick = () => { NP.app = b.dataset.npapp; NP.key = ""; pollMusic(); }));
}
function openMusicPanel() {
  const m = modal(`<div class="modal-head"><div><div class="eyebrow">Musique</div><h2>En écoute</h2></div><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body" id="npPanelBody"></div>
    <div class="modal-foot"><span class="muted" style="font-size:12px">Marche avec toute appli qui s'affiche dans le contrôle du volume de Windows : Spotify, Liner, Deezer, Apple Music, YouTube…</span></div>`, "narrow");
  drawPanel($("#npPanelBody", m.el));
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollMusic(); });

// ───────────────────────── Fonds vidéo, son et intro ─────────────────────────
const mediaUrl = (path) => !path ? "" : /^(blob:|https:|data:)/.test(path) ? path : (TAURI ? TAURI.core.convertFileSrc(path) : "");
const MEDIA = { gameRunning: false };

function applyMedia() {
  const t = theme();
  const video = $("#bgVideo"), audio = $("#bgAudio");
  const muteAll = MEDIA.gameRunning && t.pauseInGame !== false;
  // Vidéo de fond : image + son, image seule ou son seul.
  const useVideo = t.mode === "video" && t.video;
  const show = useVideo && t.videoUse !== "audio";
  const sound = useVideo && t.videoUse !== "image";
  const src = mediaUrl(t.video);
  if (useVideo && video.dataset.src !== src) { video.dataset.src = src; video.src = src; }
  if (!useVideo && video.dataset.src) { video.pause(); video.removeAttribute("src"); video.dataset.src = ""; video.load(); }
  video.classList.toggle("on", !!show);
  video.style.filter = t.imageBlur ? `blur(${t.imageBlur}px)` : "";
  video.muted = !sound;
  video.volume = Math.min(1, t.videoVolume ?? 0.5);
  video.playbackRate = t.videoSpeed ?? 1;
  if (useVideo && !muteAll) video.play().catch(() => {}); else if (useVideo) video.pause();
  if (useVideo) { const dim = $("#bgDim"); dim.style.opacity = show ? t.imageDim : 0; dim.style.background = "var(--bg)"; }
  // Musique de fond.
  const msrc = mediaUrl(t.music);
  const musicOn = t.musicOn && t.music;
  if (musicOn && audio.dataset.src !== msrc) { audio.dataset.src = msrc; audio.src = msrc; }
  if (!musicOn && audio.dataset.src) { audio.pause(); audio.removeAttribute("src"); audio.dataset.src = ""; }
  audio.volume = Math.min(1, t.musicVolume ?? 0.4);
  if (musicOn && !muteAll) audio.play().catch(() => {}); else audio.pause();
}
const _apply = window.applyCustomTheme;
window.applyCustomTheme = function () { _apply(); applyMedia(); renderMusic(); };

// L'intro au lancement : la vidéo choisie, par-dessus l'écran de démarrage.
window.playIntro = function () {
  const t = theme();
  if (!t.introOn || !t.intro) return Promise.resolve();
  const box = $("#intro"), video = $("video", box);
  return new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (done) return; done = true;
      box.classList.add("out");
      setTimeout(() => { box.hidden = true; box.classList.remove("out"); video.pause(); video.removeAttribute("src"); resolve(); }, 700);
    };
    box.hidden = false;
    video.src = mediaUrl(t.intro);
    video.muted = t.introSound === false;
    video.volume = Math.min(1, t.introVolume ?? 0.8);
    video.onended = end; video.onerror = end;
    video.play().catch(() => { video.muted = true; video.play().catch(end); });
    $("#introSkip").onclick = end;
    box.onclick = (e) => { if (e.target === box || e.target === video) end(); };
    const esc = (e) => { if (e.key === "Escape" || e.key === " ") { document.removeEventListener("keydown", esc); end(); } };
    document.addEventListener("keydown", esc);
    if (t.introMax) setTimeout(end, t.introMax * 1000);
  });
};

// Le jeu lancé : on coupe le fond pour ne pas voler de performances ni de son.
listen("game-started", () => { MEDIA.gameRunning = true; applyMedia(); });
listen("game-exit", () => { MEDIA.gameRunning = S.running.size > 0; applyMedia(); });

/// Envoie un fichier choisi au launcher, qui le range dans media/ ; renvoie son chemin.
async function importMedia(kind, file) {
  if (!TAURI) return URL.createObjectURL(file);
  if (file.size > 600 * 1024 * 1024) throw "Fichier trop lourd (600 Mo au maximum).";
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke("save_media", bytes, { headers: { "x-kind": kind, "x-name": encodeURIComponent(file.name) } });
}

function mediaSection(t) {
  const fileRow = (kind, key, title, desc, accept, extra = "") => `<div class="set-row"><div class="txt"><b>${title}</b><span>${desc}</span>
      <div class="flex mt"><button class="btn small" data-pick="${kind}" data-key="${key}">${I.folder} ${t[key] ? "Changer" : "Choisir un fichier"}</button>${t[key] ? `<button class="btn small ghost" data-clear="${kind}" data-key="${key}">${I.trash} Retirer</button>` : ""}<span class="muted" style="font-size:12px">${t[key] ? "✓ " + h(decodeURIComponent(String(t[key]).split(/[\\/]/).pop()).replace(/^\w+-[0-9a-f]+\./, "fichier.")) : ""}</span></div>
      <input type="file" hidden accept="${accept}" data-file="${kind}" data-key="${key}"></div>${extra}</div>`;
  const rng = (k, min, max, step, fmt) => `<div class="set-row"><div class="txt"><b>${{ videoVolume: "Volume de la vidéo", videoSpeed: "Vitesse de la vidéo", musicVolume: "Volume de la musique", introVolume: "Volume de l'intro", introMax: "Durée maximale de l'intro" }[k]}</b></div><div class="range-row"><input type="range" class="range" data-mrange="${k}" min="${min}" max="${max}" step="${step}" value="${t[k]}"><b data-mrv="${k}">${fmt(t[k])}</b></div></div>`;
  const tog = (k, title, desc) => `<div class="set-row"><div class="txt"><b>${title}</b><span>${desc}</span></div><button class="switch ${t[k] ? "on" : ""}" data-mt="${k}"></button></div>`;
  return `<div class="set-card glass" id="thMedia"><h3>${I.palette} Vidéo, intro et musique</h3>
    <p class="muted" style="font-size:12.5px;padding:2px 0 8px">Mets tes edits Minecraft en fond, en intro au lancement, ou juste leur son. Choisis tes fichiers : vidéo (.mp4, .webm), image ou son (.mp3, .ogg…).</p>
    ${fileRow("video", "video", "Vidéo de fond", "Remplace le fond du launcher (style « Vidéo » ci-dessus).", "video/mp4,video/webm,.mp4,.webm,.m4v,.mov")}
    <div class="set-row"><div class="txt"><b>Utiliser de la vidéo</b><span>L'image et le son, l'image seule, ou seulement le son.</span></div>${seg([["both", "Image + son"], ["image", "Image seule"], ["audio", "Son seul"]], t.videoUse, null, "mUse")}</div>
    ${rng("videoVolume", 0, 1, 0.01, pct)}
    ${rng("videoSpeed", 0.25, 2, 0.05, (v) => "×" + (+v).toFixed(2))}
    ${fileRow("intro", "intro", "Intro au lancement", "Une vidéo jouée à l'ouverture du launcher. Clic, Échap ou « Passer » pour la couper.", "video/mp4,video/webm,.mp4,.webm,.m4v,.mov")}
    ${tog("introOn", "Jouer l'intro à l'ouverture", "")}
    ${tog("introSound", "Son de l'intro", "")}
    ${rng("introVolume", 0, 1, 0.01, pct)}
    ${rng("introMax", 0, 30, 1, (v) => (+v ? v + " s" : "entière"))}
    ${fileRow("audio", "music", "Musique de fond", "Un son qui tourne en boucle dans le launcher (ou le son d'une vidéo).", "audio/*,.mp3,.ogg,.wav,.m4a,.flac,.mp4,.webm")}
    ${tog("musicOn", "Jouer la musique de fond", "")}
    ${rng("musicVolume", 0, 1, 0.01, pct)}
    ${tog("pauseInGame", "Couper le fond pendant le jeu", "Met en pause la vidéo et la musique quand Minecraft est lancé.")}
    ${tog("player", "Lecteur de musique", "Affiche et contrôle la musique en cours (Spotify, Liner, Deezer…) dans la barre du haut et sur l'accueil.")}
  </div>`;
}
function bindMediaSection(el) {
  $$("[data-pick]", el).forEach((b) => (b.onclick = () => $(`[data-file="${b.dataset.pick}"]`, el).click()));
  $$("[data-file]", el).forEach((input) => (input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    showTask(true, `Import de ${file.name}…`, 50);
    try {
      const path = await importMedia(input.dataset.file, file);
      const patch = { [input.dataset.key]: path };
      if (input.dataset.file === "video") patch.mode = "video";
      if (input.dataset.file === "intro") patch.introOn = true;
      if (input.dataset.file === "audio") patch.musicOn = true;
      setTheme(patch); toast("Fichier importé", file.name); rerender();
    } catch (e) { fail(e); }
    showTask(false);
  }));
  $$("[data-clear]", el).forEach((b) => (b.onclick = async () => {
    try { if (TAURI) await invoke("remove_media", { kind: b.dataset.clear }); } catch (e) { fail(e); }
    const patch = { [b.dataset.key]: "" };
    if (b.dataset.clear === "video" && theme().mode === "video") patch.mode = "aurora";
    setTheme(patch); rerender();
  }));
  $$("[data-mt]", el).forEach((b) => (b.onclick = () => { const k = b.dataset.mt, v = !theme()[k]; b.classList.toggle("on", v); Sound.tick(); setTheme({ [k]: v }); }));
  $$("[data-mrange]", el).forEach((r) => {
    const k = r.dataset.mrange;
    const paint = () => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%");
    paint();
    r.oninput = () => { paint(); const fmt = { videoSpeed: (v) => "×" + (+v).toFixed(2), introMax: (v) => (+v ? v + " s" : "entière") }[k] || pct; $(`[data-mrv="${k}"]`, el).textContent = fmt(r.value); setTheme({ [k]: +r.value }); };
  });
  bindSeg(el, "mUse", (v) => setTheme({ videoUse: v }));
}
Object.assign(THEME_DEFAULT, {
  video: "", videoUse: "both", videoVolume: 0.5, videoSpeed: 1,
  intro: "", introOn: false, introSound: true, introVolume: 0.8, introMax: 0,
  music: "", musicOn: false, musicVolume: 0.4, pauseInGame: true, player: true,
});

// La page Thème gagne la section média et le style « Vidéo ».
const _renderTheme = RENDER.theme;
RENDER.theme = (el) => {
  _renderTheme(el);
  const t = theme();
  const card = $("#thImg", el)?.closest(".set-card");
  if (card) card.insertAdjacentHTML("afterend", mediaSection(t));
  const segEl = $('[data-seg="thMode"]', el);
  if (segEl && !$('[data-v="video"]', segEl)) {
    segEl.insertAdjacentHTML("beforeend", `<button data-v="video" class="${t.mode === "video" ? "on" : ""}">Vidéo</button>`);
    bindSeg(el, "thMode", (v) => {
      if (v === "video" && !theme().video) { toast("Choisis d'abord une vidéo", "Section « Vidéo, intro et musique » plus bas.", "error"); $("#thMedia", el)?.scrollIntoView({ behavior: "smooth" }); return; }
      setTheme({ mode: v });
      $("#thGrad", el).style.display = v === "gradient" ? "" : "none";
      $("#thImg", el).style.display = v === "image" ? "" : "none";
    });
  }
  bindMediaSection(el);
  stagger(el);
};

// L'accueil gagne la carte « En écoute ».
const _renderHome = RENDER.home;
RENDER.home = async (el, opts) => {
  await _renderHome(el, opts);
  const hero = $("#hero", el);
  if (hero && !$("#npCard", el)) hero.insertAdjacentHTML("afterend", `<div class="np-card glass" id="npCard" hidden></div>`);
  renderMusic();
};

// ───────────────────────── Pack Leaf Client ─────────────────────────
async function installClientPack(inst, btn) {
  if (!["fabric", "quilt"].includes(inst.loader)) return toast("Fabric ou Quilt requis", "Le Pack Leaf Client s'installe sur une instance Fabric ou Quilt.", "error");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Installation…`; }
  showTask(true, "Pack Leaf Client…", 0);
  try {
    const r = await invoke("client_pack", { instance: inst.id });
    showTask(false);
    toast("Pack Leaf Client installé", `${r.installed.length} mods dans ${inst.name}.` + (r.missing.length ? ` Pas encore dispo en ${inst.version} : ${r.missing.map((m) => m.name).join(", ")}.` : ""), r.missing.length ? "error" : "ok", 9000);
  } catch (e) { showTask(false); fail(e); }
  if (btn) { btn.disabled = false; btn.innerHTML = `${I.download} Réinstaller`; }
}
function clientPackCard(inst) {
  return `<div class="pack-card glass"><div class="pack-ico">${I.rocket}</div><div class="grow"><div class="eyebrow">Pack Leaf Client</div><h3>Freelook, zoom, HUD modifiable et plus de FPS</h3>
    <p class="muted">Freelook (regarder autour sans tourner), Zoomify (zoom), EvergreenHUD (FPS, CPS, keystrokes déplaçables en jeu), Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling, Mod Menu, AppleSkin.</p></div>
    <button class="btn primary" id="packBtn">${I.download} Installer dans ${h(inst.name)}</button></div>`;
}
const _renderLibrary = RENDER.library;
RENDER.library = async (el) => {
  await _renderLibrary(el);
  const inst = S.instances.find((i) => i.id === L.inst);
  if (inst && ["fabric", "quilt"].includes(inst.loader) && !isRust(inst)) {
    $(".lib-head", el).insertAdjacentHTML("beforebegin", clientPackCard(inst));
    $("#packBtn", el).onclick = (e) => installClientPack(inst, e.currentTarget);
  }
};

// Démarrage : le lecteur de musique tourne dès l'ouverture.
setTimeout(pollMusic, 800);
