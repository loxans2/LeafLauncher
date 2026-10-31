<p align="center"><img src="ui/logo.png" alt="LeafLauncher" width="640"></p>

# Leaf Launcher

Un launcher open source Minecraft: Java Edition en **Rust** (Tauri 2), bâti sur la base du
[launcher Horizon](https://github.com/horizon-rust/horizon/tree/main/launcher) (MIT). L'interface
est animée : aurore et particules en fond, transitions de pages en cascade, cartes inclinées en 3D,
bouton Jouer qui devient une barre de progression, etc.

> Pas un produit officiel Minecraft, ni approuvé par Mojang ou Microsoft. Le launcher télécharge
> les fichiers du jeu directement chez Mojang, sans miroir.

## Ce qu'il fait

- **Toutes les versions publiées par Mojang** : 26.3, 26.2, 26.1, 1.21.11… et aussi les snapshots,
  les bêtas et les alphas. La liste vient de piston-meta et reste en cache pour jouer hors ligne.
- **Loaders** : Vanilla, Fabric, Quilt, **Forge** et **NeoForge**, à la dernière version (la
  recommandée pour Forge) ou à une version au choix. Forge et NeoForge s'installent avec leur
  installateur officiel, lancé en mode silencieux.
- **Deux moteurs** : Minecraft officiel (Java) ou **Horizon**, Minecraft 26.3 réécrit en Rust. Un
  interrupteur JAVA ⇄ RUST sur l'accueil fait passer une instance 26.3 Vanilla de l'un à l'autre.
  Le launcher installe la Nightly d'Horizon (vérifiée par son SHA256SUMS) et la prépare depuis tes
  fichiers 26.3 avec `horizon-prepare`, une fois par build. Comme le demande Horizon, il faut un
  compte Microsoft qui possède le jeu. Horizon est une réécriture de la 26.3 seulement : les autres
  versions (26.2, 26.1, 1.21.11…) se jouent avec le moteur Java.
- **Mods (Modrinth)** : recherche de mods, packs de ressources, shaders et modpacks, filtrée sur la
  version et le loader de l'instance. Chaque fichier est vérifié en sha512, et les dépendances
  requises sont installées. On peut mettre à jour, retirer, et créer une instance depuis un modpack
  `.mrpack`.
- **Discord Rich Presence** : « Dans le launcher » ou « Joue à … », avec le temps écoulé, ton serveur
  (`play.leafsmp.fr`) et jusqu'à deux boutons. Elle passe par l'IPC local de Discord, sans dépendance.
- **Thèmes** : 12 préréglages (Leaf, Nether, End, Océan, Cerisier, Sculk, Neige…), n'importe quelle
  couleur d'accent et de fond, un fond en aurore, particules, dégradé, image ou uni, 7 formes de
  particules (quantité, vitesse, taille, couleur), polices, arrondis, taille de l'interface, flou,
  opacité, style des cartes, halo autour de la souris. Le thème s'exporte et s'importe en JSON.
- **Instances** : chacune a son dossier (mondes, mods, options), sa version, son loader, son moteur
  et son icône. On peut aussi régler sa mémoire, ses arguments JVM, sa résolution et un serveur à
  rejoindre au lancement. Elles se dupliquent, se réparent (sha1) et se suppriment.
- **Java automatique** : le Java de Mojang qui convient à chaque version (8, 17, 21, 25…), ou un
  `java.exe` au choix.
- **Comptes** : « Se connecter avec Microsoft » ouvre la page de Microsoft dans ton navigateur,
  comme Prism Launcher (OAuth + PKCE, retour sur `http://localhost`). Il existe aussi une connexion
  par code. Les comptes hors ligne marchent également. Les jetons sont chiffrés par Windows (DPAPI)
  et se renouvellent tout seuls ([SECURITY.md](SECURITY.md)).
- **Téléchargements vérifiés** : taille et sha1 de Mojang, en parallèle (1 à 64 fichiers à la fois),
  avec reprise là où ils se sont arrêtés.
- **Console**, **Nouveautés** (notes de version officielles), **Réglages** (mémoire bornée à la RAM,
  -Xms, préréglages JVM, résolution, plein écran, comportement après le lancement, stockage).
- **Raccourcis** : `Ctrl+1…8` pour les pages, `Ctrl+N` pour une nouvelle instance, `Entrée` pour
  jouer depuis l'accueil.

## Ce qui vient d'Horizon

`src/mojang.rs` (téléchargement vérifié, Java de Mojang), `src/launch.rs` (la commande Java tirée
du fichier de version) et `src/loaders.rs` (Fabric et Quilt) reprennent des modules du launcher
Horizon (voir `LICENSE-HORIZON`). `src/horizon.rs` lance le client Rust d'Horizon par son
[API de lancement](https://github.com/horizon-rust/horizon/blob/main/docs/api/launch.md).

## Compiler

Il faut Rust (`rustup`). Sous Windows, avec la toolchain GNU, il faut aussi MinGW (par exemple
WinLibs) dans le `PATH` pour `windres`. Avec la toolchain MSVC, il faut les Build Tools de Visual
Studio.

```bash
cargo build --release
```

L'exécutable est `target/release/leaf-launcher.exe`. Avec la toolchain GNU, il a besoin de
`WebView2Loader.dll`, que le build copie à côté de lui : distribue les deux ensemble. Pour un
installateur NSIS : `cargo install tauri-cli` puis `cargo tauri build`.

Mode portable : un fichier nommé `portable` à côté de l'exe met les données dans `data\` à côté de
lui. `LEAF_DATA_DIR` choisit un autre dossier.

Pour prévisualiser l'interface dans un navigateur, sans Tauri, avec des données factices :
`node tools/serve.js`, puis http://127.0.0.1:5178.

Tests sur le réseau réel (`--ignored`). `real_launch` télécharge une version, lance le jeu hors
ligne et le ferme ; `modrinth_install` installe puis retire Sodium ; `discord_ipc` parle au
Discord local :

```bash
LEAF_TEST_VERSION=1.21.11 LEAF_TEST_LOADER=forge cargo test --release -- --ignored --nocapture
```

## Connexion Microsoft

**Pour les joueurs** : rien à régler. Ils cliquent sur « Se connecter avec Microsoft » et se
connectent sur la page de Microsoft.

**Pour le mainteneur (une seule fois)** : comme tous les launchers (Prism, Horizon, MultiMC…), Leaf
Launcher a besoin de sa propre application Azure, autorisée par Mojang pour l'API Minecraft. Son
client ID est intégré au build et n'est pas un secret.

1. Crée l'application sur [portal.azure.com](https://portal.azure.com) : comptes Microsoft
   personnels, plateforme « Applications mobiles et de bureau » avec l'URI de redirection
   `http://localhost`, et « Autoriser les flux clients publics » activé.
2. Demande à Mojang l'accès à l'API Minecraft pour cette application
   ([formulaire](https://aka.ms/mce-reviewappid)), puis attends leur accord.
3. Mets son client ID dans la variable `LEAF_MSA_CLIENT_ID` du dépôt (Settings › Secrets and
   variables › Actions › Variables). Les releases compilées par GitHub l'intègrent alors. En local :
   `LEAF_MSA_CLIENT_ID=… cargo build --release`.

Une version compilée sans client ID garde les comptes hors ligne. Les réglages avancés acceptent
aussi un autre client ID. Le client ID de Prism Launcher n'est pas réutilisé : c'est l'identité de
Prism auprès de Microsoft, la page de connexion s'afficherait à son nom, et Prism demande aux autres
projets d'enregistrer leur propre application.

## Discord

1. Sur [discord.com/developers/applications](https://discord.com/developers/applications), crée
   une application nommée « LeafSMP » : c'est le nom affiché (« Joue à LeafSMP »).
2. Dans **Rich Presence › Art Assets**, envoie ton logo sous le nom `logo`.
3. Colle l'**Application ID** dans **Réglages › Discord**, et règle le serveur mis en avant et les
   boutons (liens https uniquement).

## Fichiers

Tout est dans `%APPDATA%\LeafLauncher` :

- `minecraft/` : versions, bibliothèques, ressources et loaders, partagés par toutes les instances ;
- `runtime/` : les Java de Mojang ;
- `horizon/` : les builds d'Horizon et leurs ressources préparées ;
- `instances/<id>/` : le dossier de jeu de chaque instance (`.leaf-content.json` y liste ce qui
  vient de Modrinth) ;
- `settings.json` (thème compris), `instances.json` et `accounts.json` (les jetons Microsoft y sont
  en clair, dans le profil de l'utilisateur).
