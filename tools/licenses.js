// Génère la liste des licences open source à partir du build réel : les crates Rust compilées dans
// le launcher (graphe de `cargo metadata`, dépendances normales pour Windows), plus ce qui n'est pas
// une crate (polices, code repris, composants Microsoft, logiciels téléchargés à la demande).
//   node tools/licenses.js            écrit ui/licenses.json et THIRD_PARTY_LICENSES.md
//   node tools/licenses.js --check    échoue si ces fichiers ne sont plus à jour (CI)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const cargo = process.env.CARGO || "cargo";
const meta = JSON.parse(
  execFileSync(cargo, ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc"], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  }).toString()
);

const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const rootId = meta.resolve.root;

// Seules les dépendances normales finissent dans l'exécutable (pas celles de build ni de test).
const normal = (dep) => dep.dep_kinds.some((k) => k.kind === null);
const direct = new Set(nodes.get(rootId).deps.filter(normal).map((d) => d.pkg));
const shipped = new Set();
const stack = [...direct];
while (stack.length) {
  const id = stack.pop();
  if (shipped.has(id)) continue;
  shipped.add(id);
  for (const d of nodes.get(id)?.deps || []) if (normal(d)) stack.push(d.pkg);
}

const authors = (p) => (p.authors || []).map((a) => a.replace(/\s*<[^>]*>/, "").trim()).filter(Boolean).slice(0, 2).join(", ");
const crate = (id) => {
  const p = byId.get(id);
  return {
    name: p.name,
    version: p.version,
    author: authors(p),
    license: p.license || (p.license_file ? "Voir le fichier de licence" : "Non précisée"),
    url: p.repository || p.homepage || `https://crates.io/crates/${p.name}`,
  };
};
const sortByName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
const directCrates = [...direct].map(crate).sort(sortByName);
const otherCrates = [...shipped].filter((id) => !direct.has(id)).map(crate).sort(sortByName);

const font = (name, author) => ({ name, author, license: "OFL-1.1", url: `https://fonts.google.com/specimen/${name.replace(/ /g, "+")}` });
const groups = [
  {
    id: "core",
    title: "Moteur du launcher (Rust)",
    note: "Les crates que Leaf Launcher utilise directement.",
    items: directCrates,
  },
  {
    id: "derived",
    title: "Code repris",
    items: [
      {
        name: "Horizon launcher",
        author: "Ludovic Marie et les contributeurs d'Horizon",
        license: "MIT",
        url: "https://github.com/horizon-rust/horizon",
        detail: "src/mojang.rs, src/launch.rs et src/loaders.rs viennent de ses modules (voir LICENSE-HORIZON).",
      },
    ],
  },
  {
    id: "ui",
    title: "Interface",
    note: "Polices chargées depuis Google Fonts.",
    items: [
      font("Inter", "Rasmus Andersson"),
      font("Space Grotesk", "Florian Karsten"),
      font("JetBrains Mono", "JetBrains"),
      font("Poppins", "Indian Type Foundry"),
      font("Nunito", "Vernon Adams"),
      font("Outfit", "Rodrigo Fuenzalida"),
      font("Rubik", "Hubert & Fischer"),
      font("Righteous", "Astigmatic"),
      font("Press Start 2P", "CodeMan38"),
      font("VT323", "Peter Hull"),
      font("Bungee", "David Jonathan Ross"),
      {
        name: "Microsoft Edge WebView2",
        author: "Microsoft",
        license: "Composant de Windows",
        url: "https://developer.microsoft.com/microsoft-edge/webview2/",
        detail: "Affiche l'interface. WebView2Loader.dll est redistribuée selon la licence du SDK WebView2.",
      },
    ],
  },
  {
    id: "downloaded",
    title: "Téléchargés à la demande",
    note: "Pas inclus dans le launcher : téléchargés depuis leurs sources officielles quand tu en as besoin.",
    items: [
      { name: "Minecraft: Java Edition", author: "Mojang Studios", license: "Minecraft EULA", url: "https://www.minecraft.net/eula", detail: "Le jeu, ses bibliothèques et les Java de Mojang." },
      { name: "Horizon", author: "Horizon contributors", license: "MIT", url: "https://github.com/horizon-rust/horizon", detail: "Le moteur Rust, installé depuis ses releases GitHub." },
      { name: "Fabric Loader", author: "FabricMC", license: "Apache-2.0", url: "https://fabricmc.net" },
      { name: "Quilt Loader", author: "QuiltMC", license: "Apache-2.0", url: "https://quiltmc.org" },
      { name: "Minecraft Forge", author: "Forge Development LLC", license: "LGPL-2.1", url: "https://minecraftforge.net" },
      { name: "NeoForge", author: "NeoForged", license: "LGPL-2.1", url: "https://neoforged.net" },
      { name: "Mods, packs et shaders", author: "Leurs auteurs, via Modrinth", license: "Celle de chaque projet", url: "https://modrinth.com" },
    ],
  },
  {
    id: "crates",
    title: "Toutes les bibliothèques Rust embarquées",
    note: "Les dépendances des crates ci-dessus, compilées dans l'exécutable.",
    items: otherCrates,
  },
];

const out = {
  version: byId.get(rootId).version,
  generated: "Généré depuis le graphe de dépendances du build (cargo metadata), pas une liste écrite à la main.",
  total: shipped.size,
  groups,
};

const json = JSON.stringify(out, null, 2) + "\n";
let md = `# Licences open source

Leaf Launcher ${out.version} repose sur des logiciels écrits par d'autres. Chaque projet qu'il embarque
ou qu'il télécharge est listé ici, avec son auteur et sa licence. Le launcher en affiche la même
liste dans **Réglages › À propos › Licences open source**.

${out.generated} ${out.total} crates Rust sont compilées dans l'exécutable.

Fichier généré par \`node tools/licenses.js\` : ne pas le modifier à la main.
`;
for (const g of groups) {
  md += `\n## ${g.title}\n\n${g.note ? g.note + "\n\n" : ""}| Projet | Auteur | Licence |\n| --- | --- | --- |\n`;
  for (const i of g.items) {
    const name = i.version ? `${i.name} ${i.version}` : i.name;
    md += `| [${name}](${i.url}) | ${(i.author || "—").replace(/\|/g, "/")} | ${i.license.replace(/\|/g, "/")} |\n`;
  }
}
md += `\nMinecraft est une marque de Mojang Studios. Leaf Launcher est un projet indépendant, sans lien avec Mojang ni Microsoft.\n`;

const files = [
  [path.join(root, "ui", "licenses.json"), json],
  [path.join(root, "THIRD_PARTY_LICENSES.md"), md],
];
if (process.argv.includes("--check")) {
  const stale = files.filter(([f, text]) => !fs.existsSync(f) || fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n") !== text);
  if (stale.length) {
    console.error("Licences pas à jour : lance `node tools/licenses.js`. " + stale.map(([f]) => path.basename(f)).join(", "));
    process.exit(1);
  }
  console.log("Licences à jour.");
} else {
  for (const [f, text] of files) fs.writeFileSync(f, text);
  console.log(`${out.total} crates embarquées, ${directCrates.length} directes : ui/licenses.json, THIRD_PARTY_LICENSES.md`);
}
