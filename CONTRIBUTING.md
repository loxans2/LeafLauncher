# Contribuer à Leaf Launcher

Merci de vouloir aider ! Bugs, idées, traductions, code : tout est bienvenu.

## Signaler un bug ou proposer une idée

Ouvre une [issue](https://github.com/loxans2/LeafLauncher/issues/new/choose) avec le modèle qui
convient. Pour un bug, joins les logs de la **Console** du launcher : ils disent presque toujours ce
qui s'est passé.

Pour une faille de sécurité, n'ouvre pas d'issue publique : suis [SECURITY.md](SECURITY.md).

## Proposer du code

1. Forke le dépôt et crée une branche depuis `main`.
2. Compile et teste (voir [BUILD.md](BUILD.md)) : `cargo build --release` et `cargo test --release`.
3. Si tu as ajouté ou mis à jour une dépendance, régénère les licences : `node tools/licenses.js`.
4. Ouvre une pull request qui explique ce qui change et pourquoi. GitHub Actions la compile.

### Style

- **Rust** : `cargo fmt`, et des messages d'erreur en français, écrits pour le joueur (ce qu'il
  peut faire, pas une trace technique).
- **Interface** : pas de framework ni d'étape de build. Pas de gestionnaires `on…=` dans le HTML :
  la CSP les bloque. Échappe tout texte venu d'Internet avec `h()`.
- **Sécurité** : ne logue jamais un jeton, n'envoie jamais un jeton à l'interface, vérifie le hash
  de tout fichier téléchargé, et refuse un chemin venu d'Internet qui pourrait sortir de son
  dossier (`files::relative`).
- **Pas de secrets dans le dépôt** : pas de `.env`, pas de clé d'API. Le client ID Microsoft passe
  par `LEAF_MSA_CLIENT_ID` à la compilation.

## Code de conduite

En participant, tu acceptes le [code de conduite](CODE_OF_CONDUCT.md).

## Licence

Ta contribution est publiée sous la [licence MIT](LICENSE) du projet.
