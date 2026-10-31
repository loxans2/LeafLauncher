# Compiler Leaf Launcher

## Prérequis

- [Rust](https://rustup.rs) stable.
- Sous Windows, une de ces deux toolchains :
  - **MSVC** (celle de GitHub Actions) : les Build Tools de Visual Studio, avec « Développement
    Desktop en C++ ».
  - **GNU** (`rustup default stable-x86_64-pc-windows-gnu`) : MinGW dans le `PATH` pour `windres`,
    par exemple [WinLibs](https://winlibs.com). L'exécutable a alors besoin de
    `WebView2Loader.dll`, que le build copie à côté de lui : distribue les deux ensemble.
- [Node.js](https://nodejs.org), seulement pour les outils de `tools/` (aucune dépendance npm).

## Compiler

```bash
cargo build --release
```

L'exécutable est `target/release/leaf-launcher.exe`. Pour un installateur NSIS :
`cargo install tauri-cli`, puis `cargo tauri build`.

### Connexion Microsoft

Le client ID de l'application Azure se donne à la compilation :

```bash
LEAF_MSA_CLIENT_ID=00000000-0000-0000-0000-000000000000 cargo build --release
```

Sans lui, le launcher compile quand même, avec les comptes hors ligne seulement. Pour créer
l'application : [portal.azure.com](https://portal.azure.com), comptes Microsoft personnels,
plateforme « Applications mobiles et de bureau » avec l'URI de redirection `http://localhost`,
« Autoriser les flux clients publics » activé. Demande ensuite à Mojang l'accès à l'API Minecraft
([formulaire](https://aka.ms/mce-reviewappid)). Pour les releases, mets ce client ID dans la
variable `LEAF_MSA_CLIENT_ID` du dépôt (Settings › Secrets and variables › Actions › Variables).

### Discord

Crée une application sur [discord.com/developers](https://discord.com/developers/applications),
envoie le logo dans **Rich Presence › Art Assets** sous le nom `logo`, et colle l'Application ID
dans **Réglages › Discord** du launcher.

## Tests

```bash
cargo test --release
```

Les tests marqués `--ignored` passent par le vrai réseau. `real_launch` télécharge une version, lance
le jeu hors ligne puis le ferme ; `modrinth_install` installe puis retire Sodium ; `discord_ipc`
parle au Discord local :

```bash
LEAF_TEST_VERSION=1.21.11 LEAF_TEST_LOADER=forge cargo test --release -- --ignored --nocapture
```

Si le launcher est lancé depuis une application empaquetée (MSIX), Windows peut rediriger
`%APPDATA%`, et Fabric s'y perd. Donne alors un autre dossier : `LEAF_DATA_DIR=D:\LeafTest`.

## Interface

L'interface est en HTML, CSS et JavaScript, sans framework ni étape de build (`ui/`). Pour la voir
dans un navigateur, avec des données factices et la même CSP que l'application :

```bash
node tools/serve.js
```

puis http://127.0.0.1:5178.

## Licences tierces

`THIRD_PARTY_LICENSES.md` et `ui/licenses.json` sont générés depuis le graphe de dépendances du
build. Après avoir ajouté ou mis à jour une dépendance :

```bash
node tools/licenses.js
```

La CI vérifie qu'ils sont à jour (`node tools/licenses.js --check`).

## Données

Tout est dans `%APPDATA%\LeafLauncher` :

- `minecraft/` : versions, bibliothèques, ressources et loaders, partagés par les instances ;
- `runtime/` : les Java de Mojang ;
- `horizon/` : les builds d'Horizon et leurs ressources préparées ;
- `instances/<id>/` : le dossier de jeu de chaque instance (`.leaf-content.json` y liste ce qui
  vient de Modrinth) ;
- `settings.json` (thème compris), `instances.json` et `accounts.json`, avec les jetons Microsoft
  chiffrés par DPAPI.

Mode portable : un fichier nommé `portable` à côté de l'exe met les données dans `data\` à côté de
lui.
