"use strict";
/* Leaf Launcher — thèmes, bibliothèque Modrinth, Discord, Horizon (Rust). Chargé après app.js. */

// ───────────────────────── Thèmes ─────────────────────────
const PRESETS = {
  leaf: { name: "Leaf", sub: "Le vert LeafSMP", accent: "#4ade80", bg: "#070b0a", particleStyle: "pixels" },
  nether: { name: "Nether", sub: "Lave et braises", accent: "#f97316", bg: "#120705", particleStyle: "embers" },
  end: { name: "End", sub: "Le vide étoilé", accent: "#c084fc", bg: "#0a0713", particleStyle: "stars" },
  ocean: { name: "Océan", sub: "Bulles des abysses", accent: "#38bdf8", bg: "#04101a", particleStyle: "bubbles" },
  cherry: { name: "Cerisier", sub: "Pétales roses", accent: "#f9a8d4", bg: "#140a10", particleStyle: "leaves", particleColor: "#fbcfe8" },
  sculk: { name: "Sculk", sub: "Deep Dark", accent: "#2dd4bf", bg: "#020d0e", particleStyle: "pixels" },
  snow: { name: "Neige", sub: "Biome gelé", accent: "#e2e8f0", bg: "#0b0e13", particleStyle: "snow", particleColor: "#ffffff" },
  gold: { name: "Or", sub: "Le trésor", accent: "#facc15", bg: "#100d04", particleStyle: "dots" },
  redstone: { name: "Redstone", sub: "Circuits", accent: "#ef4444", bg: "#110506", particleStyle: "pixels" },
  midnight: { name: "Minuit", sub: "Bleu nuit", accent: "#818cf8", bg: "#06070f", particleStyle: "stars" },
  forest: { name: "Automne", sub: "Feuilles qui tombent", accent: "#a3e635", bg: "#0a0d06", particleStyle: "leaves", particleColor: "#fb923c" },
  amethyst: { name: "Améthyste", sub: "Géode", accent: "#a78bfa", bg: "#0c0815", particleStyle: "dots" },
};
const THEME_DEFAULT = {
  preset: "leaf", accent: "#4ade80", bg: "#070b0a", mode: "aurora", gradA: "#0d2a1f", gradB: "#05070a",
  image: "", imageDim: 0.55, imageBlur: 0, particleStyle: "pixels", particleColor: "", density: 1, speed: 1, particleSize: 1,
  font: "Inter", display: "Space Grotesk", radius: 1, scale: 1, blur: 22, panel: 0.62, cards: "glass",
  labels: true, grain: true, glow: false,
};
const FONTS = ["Inter", "Poppins", "Nunito", "Outfit", "Rubik", "JetBrains Mono"];
const DISPLAY_FONTS = ["Space Grotesk", "Poppins", "Outfit", "Righteous", "Press Start 2P", "VT323", "Bungee"];
const loadedFonts = new Set(["Inter", "Space Grotesk", "JetBrains Mono"]);

const theme = () => ({ ...THEME_DEFAULT, ...(S.settings.theme || {}) });
function shade(hex, amt) {
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return "#" + hexRgb(hex).map((c) => f(c).toString(16).padStart(2, "0")).join("");
}
const rgbStr = (hex) => hexRgb(hex).join(", ");
function loadFont(name) {
  if (!name || loadedFonts.has(name)) return;
  loadedFonts.add(name);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  document.head.append(link);
}

window.applyCustomTheme = function () {
  const t = theme(), root = document.documentElement.style;
  const a = t.accent, bg = t.bg;
  root.setProperty("--accent", a);
  root.setProperty("--accent-2", shade(a, -0.2));
  root.setProperty("--accent-3", shade(a, 0.3));
  root.setProperty("--accent-rgb", rgbStr(a));
  root.setProperty("--bg", bg);
  root.setProperty("--bg-2", shade(bg, 0.03));
  root.setProperty("--panel", `rgba(${rgbStr(shade(bg, 0.07))}, ${t.panel})`);
  root.setProperty("--panel-2", `rgba(${rgbStr(shade(bg, 0.12))}, ${Math.min(1, t.panel + 0.05)})`);
  root.setProperty("--panel-solid", shade(bg, 0.08));
  root.setProperty("--line", `rgba(${rgbStr(shade(a, 0.5))}, .08)`);
  root.setProperty("--line-2", `rgba(${rgbStr(shade(a, 0.5))}, .16)`);
  root.setProperty("--blur", t.blur + "px");
  root.setProperty("--rs", t.radius);
  loadFont(t.font); loadFont(t.display);
  root.setProperty("--font", `"${t.font}", "Segoe UI", system-ui, sans-serif`);
  root.setProperty("--display", `"${t.display}", "${t.font}", "Segoe UI", sans-serif`);
  document.body.style.zoom = t.scale;
  document.body.classList.toggle("no-labels", !t.labels);
  document.body.classList.toggle("no-grain", !t.grain);
  document.body.classList.toggle("glow", !!t.glow);
  document.body.classList.toggle("cards-solid", t.cards === "solid");
  document.body.classList.toggle("cards-outline", t.cards === "outline");
  S.settings.background = t.mode === "minimal" ? "minimal" : t.mode;
  const img = $("#bgImage"), dim = $("#bgDim");
  const showImg = t.mode === "image" && t.image;
  img.classList.toggle("on", !!showImg);
  if (showImg) { img.style.backgroundImage = `url("${t.image.replace(/"/g, "%22")}")`; img.style.filter = t.imageBlur ? `blur(${t.imageBlur}px)` : ""; }
  dim.style.opacity = showImg ? t.imageDim : t.mode === "solid" ? 1 : 0;
  if (t.mode === "solid") dim.style.background = bg; else dim.style.background = "var(--bg)";
  setTimeout(moveIndicator, 50);
};
// Le halo qui suit la souris.
addEventListener("mousemove", (e) => {
  const g = $("#cursorGlow");
  if (g && document.body.classList.contains("glow")) g.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

let themeTimer;
function setTheme(patch, rebuildParticles = false) {
  S.settings.theme = { ...theme(), ...patch };
  applyCustomTheme();
  if (rebuildParticles) BG.resize();
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => saveSettings({}), 350);
}

function rangeRow(id, min, max, step, value, fmt) {
  return `<div class="range-row"><input type="range" class="range" data-range="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><b data-rv="${id}">${fmt(value)}</b></div>`;
}
const pct = (v) => Math.round(v * 100) + " %";
const RANGES = {
  density: [0, 3, 0.1, (v) => "×" + (+v).toFixed(1), true], speed: [0.1, 3, 0.1, (v) => "×" + (+v).toFixed(1)], particleSize: [0.5, 3, 0.1, (v) => "×" + (+v).toFixed(1)],
  radius: [0, 2, 0.05, (v) => "×" + (+v).toFixed(2)], scale: [0.8, 1.25, 0.01, pct], blur: [0, 40, 1, (v) => v + " px"], panel: [0.2, 1, 0.01, pct],
  imageDim: [0, 0.95, 0.01, pct], imageBlur: [0, 30, 1, (v) => v + " px"],
};

RENDER.theme = (el) => {
  const t = theme();
  const tog = (k, title, desc) => `<div class="set-row"><div class="txt"><b>${title}</b><span>${desc}</span></div><button class="switch ${t[k] ? "on" : ""}" data-tt="${k}"></button></div>`;
  const row = (k, title, desc) => `<div class="set-row"><div class="txt"><b>${title}</b><span>${desc}</span></div>${rangeRow(k, RANGES[k][0], RANGES[k][1], RANGES[k][2], t[k], RANGES[k][3])}</div>`;
  const styles = [["pixels", "Pixels"], ["leaves", "Feuilles"], ["snow", "Neige"], ["stars", "Étoiles"], ["bubbles", "Bulles"], ["embers", "Braises"], ["dots", "Points"], ["none", "Aucune"]];
  el.innerHTML = `<div data-stagger>
    <div class="page-head"><div><div class="eyebrow">Personnalisation</div><h1>Thème</h1><p>Tout se règle en direct : couleurs, fond, particules, polices, formes et taille.</p></div>
      <div class="theme-actions"><button class="btn" id="thExport">${I.copy} Exporter</button><button class="btn" id="thImport">${I.download} Importer</button><button class="btn danger" id="thReset">Réinitialiser</button></div></div>
    <div class="set-card glass"><h3>${I.palette} Préréglages</h3><div class="presets" style="padding:6px 0 18px">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset ${t.preset === k ? "on" : ""}" data-preset-theme="${k}" style="--pbg:${p.bg};--pac:${p.accent}"><i></i><b>${p.name}</b><span>${p.sub}</span></button>`).join("")}</div></div>
    <div class="set-card glass"><h3>${I.palette} Couleurs</h3>
      <div class="set-row"><div class="txt"><b>Couleur d'accent</b><span>Boutons, sélection, lueurs, fond animé.</span></div><div class="color-row"><input type="color" data-color="accent" value="${t.accent}"><input class="input" data-hex="accent" value="${t.accent}" style="width:110px;font-family:var(--mono)"></div></div>
      <div class="set-row"><div class="txt"><b>Couleur de fond</b><span>La teinte de base du launcher et de ses panneaux.</span></div><div class="color-row"><input type="color" data-color="bg" value="${t.bg}"><input class="input" data-hex="bg" value="${t.bg}" style="width:110px;font-family:var(--mono)"></div></div>
      <div class="set-row"><div class="txt"><b>Couleur des particules</b><span>Vide : celle de l'accent.</span></div><div class="color-row"><input type="color" data-color="particleColor" value="${t.particleColor || t.accent}"><button class="btn small" id="thPcAuto">Auto</button></div></div>
    </div>
    <div class="set-card glass"><h3>${I.layers} Arrière-plan</h3>
      <div class="set-row"><div class="txt"><b>Style</b><span>L'aurore bouge doucement, le dégradé et l'uni restent sobres, l'image est la tienne.</span></div>${seg([["aurora", "Aurore"], ["particles", "Particules"], ["gradient", "Dégradé"], ["image", "Image"], ["solid", "Uni"], ["minimal", "Minimal"]], t.mode, null, "thMode")}</div>
      <div class="set-row" id="thGrad" style="${t.mode === "gradient" ? "" : "display:none"}"><div class="txt"><b>Dégradé</b><span>Du coin haut-gauche au coin bas-droit.</span></div><div class="color-row"><input type="color" data-color="gradA" value="${t.gradA}"><span class="muted">→</span><input type="color" data-color="gradB" value="${t.gradB}"></div></div>
      <div id="thImg" style="${t.mode === "image" ? "" : "display:none"}">
        <div class="set-row"><div class="txt"><b>Image de fond</b><span>Une image de ton ordinateur, ou un lien https (une capture de ton serveur par exemple).</span>
          <div class="flex mt"><button class="btn small" id="thPick">${I.folder} Choisir une image</button><input class="input" id="thUrl" placeholder="https://…" value="${t.image.startsWith("data:") ? "" : h(t.image)}" style="height:32px;max-width:280px"></div></div>
          <div class="bg-thumb" id="thThumb" style="${t.image ? `background-image:url('${t.image.replace(/'/g, "%27")}')` : ""}">${t.image ? "" : "Aucune image"}</div></div>
        ${row("imageDim", "Assombrir", "Pour que le texte reste lisible.")}
        ${row("imageBlur", "Flou", "Floute l'image derrière les panneaux.")}
        <input type="file" id="thFile" accept="image/*" hidden>
      </div>
    </div>
    <div class="set-card glass"><h3>${I.cube} Particules</h3>
      <div class="set-row col"><div class="txt"><b>Forme</b><span>Ce qui flotte dans le fond.</span></div><div class="font-pick">${styles.map(([k, n]) => `<button data-pstyle="${k}" class="${t.particleStyle === k ? "on" : ""}" style="font-size:13.5px">${n}</button>`).join("")}</div></div>
      ${row("density", "Quantité", "0 : aucune, ×3 : une tempête.")}
      ${row("speed", "Vitesse", "La vitesse des particules et de l'aurore.")}
      ${row("particleSize", "Taille", "")}
    </div>
    <div class="set-card glass"><h3>${I.file} Typographie</h3>
      <div class="set-row col"><div class="txt"><b>Police du texte</b></div><div class="font-pick">${FONTS.map((f) => `<button data-font="${f}" class="${t.font === f ? "on" : ""}" style="font-family:'${f}'">${f}</button>`).join("")}</div></div>
      <div class="set-row col"><div class="txt"><b>Police des titres</b><span>Press Start 2P et VT323 font très « pixel ».</span></div><div class="font-pick">${DISPLAY_FONTS.map((f) => `<button data-display="${f}" class="${t.display === f ? "on" : ""}" style="font-family:'${f}';font-size:${f === "Press Start 2P" ? 11 : 16}px">${f}</button>`).join("")}</div></div>
    </div>
    <div class="set-card glass"><h3>${I.gear} Interface</h3>
      ${row("scale", "Taille de l'interface", "Agrandit ou réduit tout le launcher.")}
      ${row("radius", "Arrondis", "0 : des angles droits, très « bloc ».")}
      ${row("blur", "Flou du verre", "Le flou derrière les panneaux.")}
      ${row("panel", "Opacité des panneaux", "")}
      <div class="set-row"><div class="txt"><b>Style des cartes</b><span>Verre dépoli, plein ou simple contour.</span></div>${seg([["glass", "Verre"], ["solid", "Plein"], ["outline", "Contour"]], t.cards, null, "thCards")}</div>
      ${tog("labels", "Noms dans la barre latérale", "Sinon, juste les icônes.")}
      ${tog("grain", "Grain", "Un léger grain de film sur tout le launcher.")}
      ${tog("glow", "Halo autour de la souris", "Une lueur de la couleur d'accent qui suit le curseur.")}
    </div></div>`;

  $$("[data-preset-theme]", el).forEach((b) => (b.onclick = () => {
    const p = PRESETS[b.dataset.presetTheme];
    setTheme({ preset: b.dataset.presetTheme, accent: p.accent, bg: p.bg, particleStyle: p.particleStyle, particleColor: p.particleColor || "" }, true);
    Sound.ok(); rerender();
  }));
  $$("[data-color]", el).forEach((i) => (i.oninput = () => {
    const k = i.dataset.color;
    setTheme({ [k]: i.value, preset: "" });
    const hex = $(`[data-hex="${k}"]`, el); if (hex) hex.value = i.value;
  }));
  $$("[data-hex]", el).forEach((i) => (i.onchange = () => {
    const v = i.value.trim().startsWith("#") ? i.value.trim() : "#" + i.value.trim();
    if (!/^#[\da-f]{6}$/i.test(v)) return toast("Couleur invalide", "Format attendu : #4ade80", "error");
    setTheme({ [i.dataset.hex]: v, preset: "" });
    $(`[data-color="${i.dataset.hex}"]`, el).value = v;
  }));
  $("#thPcAuto", el).onclick = () => { setTheme({ particleColor: "" }); toast("Particules", "Elles suivent la couleur d'accent."); };
  $$("[data-range]", el).forEach((r) => {
    const k = r.dataset.range, [min, max, , fmt, rebuild] = RANGES[k];
    const paint = () => r.style.setProperty("--p", ((r.value - min) / (max - min)) * 100 + "%");
    paint();
    r.oninput = () => { paint(); $(`[data-rv="${k}"]`, el).textContent = fmt(r.value); setTheme({ [k]: +r.value }, rebuild); };
  });
  bindSeg(el, "thMode", (v) => {
    setTheme({ mode: v });
    $("#thGrad", el).style.display = v === "gradient" ? "" : "none";
    $("#thImg", el).style.display = v === "image" ? "" : "none";
  });
  bindSeg(el, "thCards", (v) => setTheme({ cards: v }));
  $$("[data-tt]", el).forEach((b) => (b.onclick = () => { const k = b.dataset.tt, v = !theme()[k]; b.classList.toggle("on", v); Sound.tick(); setTheme({ [k]: v }); }));
  $$("[data-pstyle]", el).forEach((b) => (b.onclick = () => { $$("[data-pstyle]", el).forEach((x) => x.classList.toggle("on", x === b)); Sound.tick(); setTheme({ particleStyle: b.dataset.pstyle }); }));
  $$("[data-font]", el).forEach((b) => (b.onclick = () => { $$("[data-font]", el).forEach((x) => x.classList.toggle("on", x === b)); setTheme({ font: b.dataset.font }); }));
  $$("[data-display]", el).forEach((b) => (b.onclick = () => { $$("[data-display]", el).forEach((x) => x.classList.toggle("on", x === b)); setTheme({ display: b.dataset.display }); }));
  DISPLAY_FONTS.concat(FONTS).forEach(loadFont);
  const setImage = (src) => { setTheme({ image: src, mode: "image" }); const th = $("#thThumb", el); th.style.backgroundImage = `url('${src.replace(/'/g, "%27")}')`; th.textContent = ""; };
  $("#thPick", el).onclick = () => $("#thFile", el).click();
  $("#thFile", el).onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8e6) return toast("Image trop lourde", "8 Mo au maximum.", "error");
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result); toast("Fond appliqué", f.name); };
    reader.readAsDataURL(f);
  };
  $("#thUrl", el).onchange = (e) => { const v = e.target.value.trim(); if (v && !v.startsWith("https://")) return toast("Lien refusé", "Il doit commencer par https://", "error"); setImage(v); };
  $("#thExport", el).onclick = () => {
    const t2 = theme();
    if (t2.image.startsWith("data:")) t2.image = "";
    navigator.clipboard.writeText(JSON.stringify(t2, null, 2));
    toast("Thème copié", "Colle-le à un ami : il l'importera en un clic." + (theme().image.startsWith("data:") ? " (L'image locale n'est pas incluse.)" : ""));
  };
  $("#thImport", el).onclick = () => {
    const m = modal(`<div class="modal-head"><h2>Importer un thème</h2><button class="btn ghost icon" data-close>${I.close}</button></div>
      <div class="modal-body"><textarea class="input" id="thJson" style="min-height:220px" placeholder='{"accent": "#4ade80", …}'></textarea></div>
      <div class="modal-foot"><span class="muted">Le JSON exporté par un autre Leaf Launcher.</span><button class="btn primary" id="thDo">${I.check} Appliquer</button></div>`, "narrow");
    $("#thDo", m.el).onclick = () => {
      try {
        const j = JSON.parse($("#thJson", m.el).value);
        const clean = {};
        for (const k of Object.keys(THEME_DEFAULT)) if (k in j && typeof j[k] === typeof THEME_DEFAULT[k]) clean[k] = j[k];
        if (clean.image && !/^https:\/\//.test(clean.image)) delete clean.image;
        setTheme(clean, true); m.close(); rerender(); toast("Thème importé");
      } catch (e) { toast("JSON invalide", String(e), "error"); }
    };
  };
  $("#thReset", el).onclick = (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Confirmer"; return; }
    S.settings.theme = { ...THEME_DEFAULT };
    document.documentElement.removeAttribute("style");
    setTheme({}, true); rerender(); toast("Thème par défaut rétabli");
  };
};

// ───────────────────────── Moteur : Rust (Horizon) ou Java ─────────────────────────
function engineSwitch(inst) {
  return `<button class="engine-switch ${isRust(inst) ? "rust" : ""}" data-engine="${inst.id}" title="Passer de Minecraft officiel à Horizon (Rust) et inversement">
    Moteur<span class="knob"><span>JAVA</span><span>RUST</span></span></button>`;
}
async function toggleEngine(id) {
  const inst = S.instances.find((i) => i.id === id);
  if (!inst) return;
  const next = isRust(inst) ? "java" : "horizon";
  $$(`[data-engine="${id}"]`).forEach((b) => b.classList.toggle("rust", next === "horizon"));
  Sound.tick();
  try {
    await invoke("update_instance", { instance: { ...inst, engine: next } });
    inst.engine = next;
    if (next === "horizon") {
      const acc = activeAccount();
      toast("Moteur : Horizon (Rust)", acc && acc.kind === "microsoft"
        ? "Minecraft 26.3 réécrit en Rust. La première partie prépare Horizon (quelques minutes)."
        : "Horizon demande un compte Microsoft qui possède le jeu : connecte-en un dans Comptes.", acc && acc.kind === "microsoft" ? "ok" : "error", 7000);
    } else toast("Moteur : Minecraft officiel", "Le jeu Java de Mojang.");
    setTimeout(rerender, 450);
  } catch (e) { fail(e); $$(`[data-engine="${id}"]`).forEach((b) => b.classList.toggle("rust", next !== "horizon")); }
}

// ───────────────────────── Connexion Microsoft par le navigateur ─────────────────────────
async function msBrowserLogin() {
  if (!S.msaBuiltin && !S.settings.ms_client_id) {
    toast("Connexion Microsoft indisponible", "Cette version a été compilée sans application Microsoft. Télécharge la version publiée sur GitHub.", "error", 8000);
    return;
  }
  const m = modal(`<div class="modal-head"><h2>Connexion Microsoft</h2><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body" style="text-align:center;padding-bottom:30px"><div class="center"><div class="spinner" style="width:42px;height:42px;border-width:3px"></div></div>
    <p>La page de connexion Microsoft s'est ouverte dans ton navigateur.</p><p class="muted" style="font-size:12.5px;margin-top:6px">Connecte-toi, puis reviens ici : tout se fait tout seul.</p></div>`, "narrow");
  m.onclose = () => invoke("ms_cancel");
  try {
    const acc = await invoke("ms_browser");
    m.onclose = null; m.close();
    await refresh(); if (S.page === "accounts") rerender();
    toast("Connecté", `Bienvenue, ${acc.name} !`);
  } catch (e) {
    if (!String(e).includes("annulée")) { m.onclose = null; m.close(); fail(e); }
  }
}

// ───────────────────────── Réglages : Discord ─────────────────────────
function discordSection(s) {
  const f = (k, label, ph, hint = "") => `<div class="field"><label>${label}</label><input class="input" data-dc="${k}" value="${h(s[k])}" placeholder="${ph}">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  return `<div class="set-card glass" id="sec-discord"><h3>${I.discord} Discord Rich Presence</h3>
    <div class="set-row"><div class="txt"><b>Afficher sur mon profil Discord</b><span>Tes amis voient que tu joues, et ton serveur est mis en avant.</span></div><button class="switch ${s.discord_rpc ? "on" : ""}" data-toggle="discord_rpc"></button></div>
    <div class="set-row col">
      <div class="grid-2">${f("discord_server", "Serveur mis en avant", "play.leafsmp.fr")}${f("discord_idle", "Texte dans le launcher", "Dans le launcher")}</div>
      <div class="grid-2">${f("discord_button_label", "Bouton 1 : texte", "Rejoindre LeafSMP")}${f("discord_button_url", "Bouton 1 : lien https", "https://discord.gg/…")}</div>
      <div class="grid-2">${f("discord_button2_label", "Bouton 2 : texte", "Télécharger le launcher")}${f("discord_button2_url", "Bouton 2 : lien https", "https://…")}</div>
      <div class="grid-2">${f("discord_app_id", "ID de l'application Discord", "123456789012345678", "discord.com/developers › New Application (nomme-la « LeafSMP »)")}${f("discord_image", "Image (clé ou lien https)", "logo", "Rich Presence › Art Assets : envoie ton logo nommé « logo »")}</div>
    </div>
    <div class="set-row col"><div class="txt"><b>Aperçu</b><span>Ce que voient tes amis sur ton profil.</span></div><div id="dcPreview"></div></div>
  </div>`;
}
function discordPreview(s) {
  const img = /^https:\/\//.test(s.discord_image) ? `<img src="${h(s.discord_image)}" style="width:72px;height:72px;border-radius:12px;object-fit:cover">` : `<img src="icon.png" style="width:72px;height:72px;border-radius:12px">`;
  const btn = (l, u) => l && /^https:\/\//.test(u) ? `<div style="background:#4e5058;border-radius:4px;padding:7px;text-align:center;font-size:13px;font-weight:600;color:#fff">${h(l)}</div>` : "";
  return `<div style="max-width:340px;background:#232428;border-radius:10px;padding:14px;font-family:'gg sans','Segoe UI',sans-serif;color:#dbdee1">
    <div style="font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;margin-bottom:10px">Joue à ${s.discord_app_id ? "LeafSMP" : "(ton application)"}</div>
    <div style="display:flex;gap:12px;align-items:center">${img}<div style="font-size:13px;line-height:1.4"><b style="color:#fff">Leaf Launcher</b><div>${h(s.discord_idle || "Dans le launcher")}</div><div>🌿 ${h(s.discord_server || "")}</div><div style="color:#949ba4">00:12 écoulées</div></div></div>
    <div style="display:grid;gap:6px;margin-top:12px">${btn(s.discord_button_label, s.discord_button_url)}${btn(s.discord_button2_label, s.discord_button2_url)}</div>
    ${s.discord_app_id ? "" : `<div style="margin-top:10px;font-size:12px;color:#f0b232">⚠ Ajoute l'ID de ton application Discord pour l'activer.</div>`}</div>`;
}
function bindDiscordSection(el) {
  const draw = () => { const p = $("#dcPreview", el); if (p) p.innerHTML = discordPreview(S.settings); };
  $$("[data-dc]", el).forEach((i) => {
    i.oninput = () => { S.settings[i.dataset.dc] = i.value.trim(); draw(); };
    i.onchange = () => {
      const k = i.dataset.dc, v = i.value.trim();
      if (k.endsWith("_url") && v && !v.startsWith("https://")) return toast("Lien refusé", "Discord n'accepte que des liens https://", "error");
      saveSettings({ [k]: v });
    };
  });
  draw();
}

// ───────────────────────── Réglages : Horizon ─────────────────────────
function horizonSection() {
  const hz = S.horizon || {};
  return `<div class="set-card glass" id="sec-horizon"><h3>${I.rust} Horizon (Rust)</h3>
    <div class="set-row"><div class="txt"><b>Minecraft 26.3 réécrit en Rust</b><span>Horizon (github.com/horizon-rust/horizon) refait le jeu en Rust, avec les mêmes mondes et les mêmes règles. Passe une instance 26.3 Vanilla sur le moteur Rust avec l'interrupteur de l'accueil, et reviens à Minecraft officiel quand tu veux. Il faut un compte Microsoft qui possède le jeu ; les mods Java ne tournent pas dans Horizon.</span></div></div>
    <div class="set-row"><div class="txt"><b id="hzState">${hz.installed ? `Installé : ${h(hz.name)}` : "Pas encore installé"}</b><span>${hz.installed ? (hz.prepared ? "Prêt à jouer." : "Sera préparé au premier lancement (quelques minutes, une seule fois).") : "Il s'installera au premier lancement d'une instance Rust."}</span></div>
      <div class="ctl"><button class="btn" id="hzUpdate">${I.download} ${hz.installed ? "Mettre à jour" : "Installer"}</button><button class="btn ghost" id="hzGit">${I.globe}</button></div></div>
  </div>`;
}
function bindHorizonSection(el) {
  $("#hzGit", el)?.addEventListener("click", () => invoke("open_url", { url: "https://github.com/horizon-rust/horizon" }).catch(fail));
  $("#hzUpdate", el)?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Téléchargement…`;
    try { S.horizon = await invoke("horizon_update"); toast("Horizon est à jour", S.horizon.name); rerender(); }
    catch (err) { fail(err); b.disabled = false; b.innerHTML = `${I.download} Réessayer`; }
  });
}
listen("horizon-progress", ({ payload: p }) => showTask(p.done < p.total, `${p.stage} · ${p.done}/${p.total}`, p.total ? (p.done / p.total) * 100 : 0));

// ───────────────────────── Bibliothèque Modrinth ─────────────────────────
const L = { inst: null, kind: "mod", q: "", sort: "relevance", offset: 0, hits: [], total: 0, installed: {}, seq: 0 };
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + " M" : n >= 1e3 ? Math.round(n / 1e3) + " k" : String(n);
const KIND_LABEL = { mod: "Mods", resourcepack: "Packs de ressources", shader: "Shaders", modpack: "Modpacks", installed: "Installés" };

RENDER.library = async (el) => {
  if (!L.inst || !S.instances.find((i) => i.id === L.inst)) L.inst = selected()?.id || null;
  const inst = S.instances.find((i) => i.id === L.inst);
  el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Modrinth</div><h1>Mods & contenus</h1><p>Mods, packs de ressources, shaders et modpacks, vérifiés (sha512) et installés en un clic.</p></div>
      <div class="flex"><span class="muted" style="font-size:12.5px">Pour</span><select class="select" id="libInst" style="width:250px">${S.instances.map((i) => `<option value="${i.id}">${h(i.name)} · ${h(i.version)} ${isRust(i) ? "Rust" : h(LOADERS[i.loader])}</option>`).join("") || "<option value=''>Aucune instance</option>"}</select></div></div>
    <div class="lib-head">${seg(Object.entries(KIND_LABEL), L.kind, null, "libKind")}
      <div class="search" style="max-width:none">${I.search}<input class="input" id="libQ" placeholder="Rechercher sur Modrinth…" value="${h(L.q)}"></div>
      <select class="select" id="libSort" style="width:170px"><option value="relevance">Pertinence</option><option value="downloads">Téléchargements</option><option value="follows">Populaires</option><option value="newest">Nouveaux</option><option value="updated">Mis à jour</option></select></div>
    <div id="libBanner"></div><div class="lib-grid" id="libGrid"></div>
    <div class="center" id="libMore"></div>`;
  if (L.inst) $("#libInst", el).value = L.inst;
  $("#libSort", el).value = L.sort;
  $("#libInst", el).onchange = (e) => { L.inst = e.target.value; RENDER.library(el); };
  bindSeg(el, "libKind", (v) => { L.kind = v; search(true); });
  let timer;
  $("#libQ", el).oninput = (e) => { L.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => search(true), 350); };
  $("#libSort", el).onchange = (e) => { L.sort = e.target.value; search(true); };
  if (inst) { try { L.installed = await invoke("modrinth_installed", { instance: inst.id }) || {}; } catch { L.installed = {}; } }

  function banner() {
    const b = $("#libBanner", el);
    if (!inst) { b.innerHTML = `<div class="banner">${I.alert}<div>Crée d'abord une instance pour y installer des mods.</div><button class="btn small" id="bnNew">${I.plus} Créer</button></div>`; $("#bnNew", b).onclick = () => createModal(); return; }
    if (isRust(inst)) { b.innerHTML = `<div class="banner">${I.alert}<div>Cette instance tourne avec Horizon (Rust) : les mods Java de Modrinth ne s'y chargent pas. Repasse-la en Minecraft officiel pour les utiliser.</div></div>`; return; }
    if (L.kind === "mod" && inst.loader === "vanilla") {
      b.innerHTML = `<div class="banner">${I.alert}<div>Les mods demandent un loader. Passe <b>${h(inst.name)}</b> sur Fabric, Quilt, Forge ou NeoForge, ou crée une instance moddée.</div><button class="btn small" id="bnEdit">${I.gear} Changer le loader</button></div>`;
      $("#bnEdit", b).onclick = () => instanceDrawer(inst.id); return;
    }
    b.innerHTML = L.kind === "modpack" ? `<div class="banner" style="background:rgba(var(--accent-rgb),.07);border-color:rgba(var(--accent-rgb),.25)">${I.info}<div>Un modpack crée une nouvelle instance avec sa version, son loader et tous ses mods.</div></div>` : "";
  }

  async function search(reset) {
    banner();
    const grid = $("#libGrid", el), more = $("#libMore", el);
    if (L.kind === "installed") return drawInstalled();
    if (reset) { L.offset = 0; L.hits = []; grid.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="height:94px"></div>`).join(""); more.innerHTML = ""; }
    const seq = ++L.seq;
    try {
      const r = await invoke("modrinth_search", {
        query: L.q, kind: L.kind, sort: L.sort, offset: L.offset,
        version: L.kind === "modpack" || !inst ? "" : inst.version, loader: inst && L.kind !== "modpack" ? inst.loader : "",
      });
      if (seq !== L.seq) return;
      L.hits = reset ? r.hits : L.hits.concat(r.hits); L.total = r.total_hits;
      grid.innerHTML = L.hits.map(modCard).join("") || `<div class="empty" style="grid-column:1/-1">${I.search}Rien trouvé${inst && L.kind !== "modpack" ? ` pour Minecraft ${h(inst.version)}` : ""}.</div>`;
      grid.setAttribute("data-stagger", ""); stagger(grid); bindMods(grid);
      more.innerHTML = L.hits.length < L.total ? `<button class="btn" id="libMoreBtn">Charger plus (${fmtNum(L.total - L.hits.length)} restants)</button>` : "";
      $("#libMoreBtn", more)?.addEventListener("click", () => { L.offset += 24; search(false); });
    } catch (e) { if (seq === L.seq) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${I.alert}${h(e)}</div>`; }
  }

  function modCard(p) {
    const done = !!L.installed[p.project_id];
    const action = L.kind === "modpack" ? `<button class="btn small primary" data-pack="${p.project_id}">${I.plus} Créer</button>`
      : done ? `<button class="btn small" data-remove="${p.project_id}">${I.check} Installé</button>`
      : `<button class="btn small primary" data-install="${p.project_id}">${I.download} Installer</button>`;
    return `<div class="mod-card ${done ? "installed" : ""}" data-project="${p.project_id}" role="button">
      ${p.icon_url ? `<img src="${h(p.icon_url)}" alt="" loading="lazy">` : `<div class="noimg">${I.puzzle}</div>`}
      <div class="info"><h4>${h(p.title)}<small>par ${h(p.author)}</small></h4><p>${h(p.description)}</p>
        <div class="meta"><span>${I.download.replace("<svg", '<svg width="13" height="13"')} ${fmtNum(p.downloads)}</span><span>♥ ${fmtNum(p.follows)}</span>${(p.categories || []).slice(0, 2).map((c) => `<span>#${h(c)}</span>`).join("")}</div></div>
      <div class="act">${action}</div></div>`;
  }

  function bindMods(root) {
    $$("[data-install]", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); install(b.dataset.install, null, b); }));
    $$("[data-remove]", root).forEach((b) => {
      b.onmouseenter = () => (b.innerHTML = `${I.trash} Retirer`);
      b.onmouseleave = () => (b.innerHTML = `${I.check} Installé`);
      b.onclick = async (e) => {
        e.stopPropagation();
        const kind = L.installed[b.dataset.remove]?.kind || L.kind;
        try { await invoke("modrinth_remove", { instance: inst.id, key: b.dataset.remove, kind }); delete L.installed[b.dataset.remove]; toast("Retiré"); search(false); } catch (err) { fail(err); }
      };
    });
    $$("[data-pack]", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); installPack(b.dataset.pack, null, b); }));
    $$("[data-project]", root).forEach((c) => (c.onclick = () => projectModal(c.dataset.project)));
  }

  async function install(project, version, btn) {
    if (!inst) return;
    if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>`; }
    try {
      const done = await invoke("modrinth_install", { instance: inst.id, project, version, kind: L.kind === "installed" ? "mod" : L.kind });
      L.installed = await invoke("modrinth_installed", { instance: inst.id });
      toast("Installé", done.length > 1 ? `${done[0]} + ${done.length - 1} dépendance(s) : ${done.slice(1).join(", ")}` : done[0]);
      if (L.kind !== "installed") { const grid = $("#libGrid", el); grid.innerHTML = L.hits.map(modCard).join(""); bindMods(grid); }
      else drawInstalled();
    } catch (e) { fail(e); if (btn) { btn.disabled = false; btn.innerHTML = `${I.download} Installer`; } }
  }

  async function installPack(project, version, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>`; }
    showTask(true, "Modpack…", 0);
    try {
      const created = await invoke("modrinth_modpack", { project, version });
      S.instances.push(created); showTask(false);
      await saveSettings({ selected_instance: created.id });
      toast("Modpack installé", `${created.name} est prêt (Minecraft ${created.version}, ${LOADERS[created.loader]}).`);
      go("home");
    } catch (e) { showTask(false); fail(e); if (btn) { btn.disabled = false; btn.innerHTML = `${I.plus} Créer`; } }
  }

  async function drawInstalled() {
    const grid = $("#libGrid", el), more = $("#libMore", el);
    more.innerHTML = "";
    if (!inst) { grid.innerHTML = ""; return; }
    let d = { mods: [], resourcepacks: [], shaderpacks: [] };
    try { d = await invoke("instance_details", { id: inst.id }); } catch { /* vide */ }
    const tracked = Object.entries(L.installed);
    const files = new Set(tracked.map(([, v]) => v.file));
    const manual = [["mod", d.mods], ["resourcepack", d.resourcepacks], ["shader", d.shaderpacks]].flatMap(([k, list]) => (list || []).filter((f) => !files.has(f) && /\.(jar|zip)$/i.test(f)).map((f) => [f, { file: f, kind: k, title: f, manual: true }]));
    const all = tracked.concat(manual);
    grid.innerHTML = all.length ? all.map(([key, v]) => `<div class="mod-card installed"><div class="noimg">${v.kind === "mod" ? I.puzzle : v.kind === "shader" ? I.palette : I.layers}</div>
      <div class="info"><h4>${h(v.title)}${v.version ? `<small>${h(v.version)}</small>` : ""}</h4><p>${h(v.file)}${v.dependency ? " · dépendance" : ""}${v.manual ? " · ajouté à la main" : ""}</p><div class="meta"><span>${h(KIND_LABEL[v.kind === "shader" ? "shader" : v.kind] || v.kind)}</span></div></div>
      <div class="act flex">${v.manual ? "" : `<button class="btn small icon" data-up="${h(key)}" title="Mettre à jour">${I.download}</button>`}<button class="btn small icon danger" data-del="${h(key)}" data-k="${v.kind}" title="Retirer">${I.trash}</button></div></div>`).join("")
      : `<div class="empty" style="grid-column:1/-1">${I.puzzle}Rien d'installé dans ${h(inst.name)}.</div>`;
    if (tracked.length) more.innerHTML = `<button class="btn" id="libUpAll">${I.download} Tout mettre à jour</button>`;
    grid.setAttribute("data-stagger", ""); stagger(grid);
    $$("[data-del]", grid).forEach((b) => (b.onclick = async () => {
      try { await invoke("modrinth_remove", { instance: inst.id, key: b.dataset.del, kind: b.dataset.k }); delete L.installed[b.dataset.del]; drawInstalled(); toast("Retiré"); } catch (e) { fail(e); }
    }));
    $$("[data-up]", grid).forEach((b) => (b.onclick = async () => {
      const v = L.installed[b.dataset.up];
      b.disabled = true;
      try { await invoke("modrinth_install", { instance: inst.id, project: b.dataset.up, version: null, kind: v.kind }); L.installed = await invoke("modrinth_installed", { instance: inst.id }); drawInstalled(); toast("À jour", v.title); } catch (e) { fail(e); b.disabled = false; }
    }));
    $("#libUpAll", more)?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      let n = 0;
      for (const [key, v] of tracked.filter(([, v]) => !v.dependency)) {
        b.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> ${++n}/${tracked.length}`;
        try { await invoke("modrinth_install", { instance: inst.id, project: key, version: null, kind: v.kind }); } catch (err) { toast(v.title, String(err), "error"); }
      }
      L.installed = await invoke("modrinth_installed", { instance: inst.id });
      drawInstalled(); toast("Tout est à jour");
    });
  }

  async function projectModal(id) {
    const m = modal(`<div class="modal-body" id="pmBody" style="padding-top:24px"><div class="center"><div class="spinner"></div></div></div>`, "wide");
    try {
      const kind = L.kind === "installed" ? "mod" : L.kind;
      const { project: p, versions } = await invoke("modrinth_project", { id, version: inst && kind !== "modpack" ? inst.version : "", loader: inst ? inst.loader : "", kind });
      const url = `https://modrinth.com/${p.project_type}/${p.slug}`;
      $("#pmBody", m.el).innerHTML = `<div class="flex" style="align-items:flex-start;gap:18px">
          ${p.icon_url ? `<img src="${h(p.icon_url)}" style="width:84px;height:84px;border-radius:calc(18px * var(--rs,1))">` : ""}
          <div class="grow"><div class="eyebrow">${h(KIND_LABEL[kind])}</div><h2 style="font:700 24px var(--display)">${h(p.title)}</h2><p class="muted">${h(p.description)}</p>
            <div class="chips mt"><span class="chip">${I.download.replace("<svg", '<svg width="13" height="13"')} ${fmtNum(p.downloads)}</span><span class="chip">♥ ${fmtNum(p.followers)}</span>${(p.loaders || []).map((l) => `<span class="chip">${h(l)}</span>`).join("")}<span class="chip">${h(p.license?.id || "")}</span></div></div>
          <button class="btn ghost icon" data-close>${I.close}</button></div>
        ${(p.gallery || []).length ? `<div class="gallery">${p.gallery.slice(0, 8).map((g) => `<img src="${h(g.url)}" alt="" loading="lazy">`).join("")}</div>` : ""}
        <div class="section-title" style="margin-top:18px"><h2>${kind === "modpack" ? "Versions" : inst ? `Versions pour ${h(inst.version)} · ${h(LOADERS[inst.loader])}` : "Versions"}</h2><button class="link" id="pmWeb">Voir sur Modrinth ${I.arrow}</button></div>
        <div>${versions.length ? versions.slice(0, 12).map((v) => `<div class="ver-row"><b>${h(v.version_number)}</b><span class="tag ${v.version_type === "release" ? "release" : "snapshot"}">${h(v.version_type)}</span><span class="grow">${h(v.name)} · ${fmtDate(v.date_published)} · ${fmtNum(v.downloads)}</span>
            <button class="btn small ${kind === "modpack" ? "" : "primary"}" data-v="${h(v.id)}">${kind === "modpack" ? `${I.plus} Créer` : `${I.download} Installer`}</button></div>`).join("")
          : `<div class="empty">${kind === "modpack" ? "Clique sur Créer depuis la liste pour installer la dernière version." : "Aucune version compatible avec cette instance."}</div>`}</div>`;
      $("#pmWeb", m.el).onclick = () => invoke("open_url", { url }).catch(fail);
      $$("[data-close]", m.el).forEach((b) => (b.onclick = m.close));
      $$("[data-v]", m.el).forEach((b) => (b.onclick = () => kind === "modpack" ? (m.close(), installPack(id, b.dataset.v, null)) : install(id, b.dataset.v, b)));
    } catch (e) { $("#pmBody", m.el).innerHTML = `<div class="empty">${I.alert}${h(e)}</div>`; }
  }

  search(true);
};
listen("modpack-progress", ({ payload: p }) => showTask(true, `${p.stage} · ${p.done}/${p.total}`, p.total ? (p.done / p.total) * 100 : 0));


// ───────────────────────── Licences open source ─────────────────────────
// La liste vient de ui/licenses.json, généré depuis le graphe de dépendances du build.
async function openLicenses() {
  const m = modal(`<div class="modal-head"><div><div class="eyebrow">Mentions légales</div><h2>Licences open source</h2></div><button class="btn ghost icon" data-close>${I.close}</button></div>
    <div class="modal-body" id="licBody"><div class="center"><div class="spinner"></div></div></div>`, "wide");
  let data;
  try { data = await (await fetch("licenses.json")).json(); }
  catch (e) { $("#licBody", m.el).innerHTML = `<div class="empty">${I.alert}${h(e)}</div>`; return; }
  const body = $("#licBody", m.el);
  body.innerHTML = `<p class="muted" style="max-width:640px">Leaf Launcher repose sur des logiciels écrits par d'autres. Chaque projet qu'il embarque ou télécharge est listé ici avec son auteur et sa licence. ${h(data.generated)}</p>
    <div class="toolbar mt"><div class="search" style="max-width:none">${I.search}<input class="input" id="licQ" placeholder="Rechercher parmi ${data.total + 20} projets…"></div></div>
    <div id="licGroups"></div>
    <p class="muted mt" style="font-size:12px">Minecraft est une marque de Mojang Studios. Leaf Launcher est un projet indépendant, sans lien avec Mojang ni Microsoft.</p>`;
  const draw = () => {
    const q = $("#licQ", body).value.trim().toLowerCase();
    $("#licGroups", body).innerHTML = data.groups.map((g) => {
      const items = g.items.filter((i) => !q || [i.name, i.author, i.license].join(" ").toLowerCase().includes(q));
      if (!items.length) return "";
      return `<div class="lic-group"><div class="lic-title">${h(g.title)} <span>${items.length}</span></div>${g.note ? `<p class="muted" style="font-size:12.5px;margin:-4px 0 10px">${h(g.note)}</p>` : ""}
        <div class="lic-grid">${items.map((i) => `<button class="lic-item" data-url="${h(i.url)}" title="${h(i.detail || i.url)}"><b>${h(i.name)}${i.version ? ` <small>${h(i.version)}</small>` : ""}</b><span>${h(i.author || "—")}</span><em>${h(i.license)}</em></button>`).join("")}</div></div>`;
    }).join("") || `<div class="empty">${I.search}Aucun projet ne correspond.</div>`;
    $$(".lic-item", body).forEach((b) => (b.onclick = () => b.dataset.url.startsWith("https://") && invoke("open_url", { url: b.dataset.url }).catch(fail)));
  };
  $("#licQ", body).oninput = draw;
  draw();
}
