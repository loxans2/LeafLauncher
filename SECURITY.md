# Sécurité

## Ce que fait le launcher pour protéger ton compte

- **Connexion Microsoft officielle** : tu te connectes sur la page de Microsoft, dans ton navigateur
  (OAuth 2.0 avec PKCE). Le launcher ne voit jamais ton mot de passe.
- **Jetons chiffrés** : les jetons Microsoft et Minecraft sont chiffrés avec DPAPI, le coffre de
  Windows. Seule ta session Windows peut les relire, même si `accounts.json` est copié ailleurs.
  L'interface ne reçoit jamais les jetons : seulement le pseudo et l'UUID.
- **Fichiers vérifiés** : tout ce qui est téléchargé est contrôlé (sha1 de Mojang, sha512 de
  Modrinth, sha256 des builds d'Horizon) avant d'être écrit. Les chemins venant d'Internet sont
  refusés s'ils pourraient sortir de leur dossier.
- **Interface isolée** : une politique de sécurité du contenu (CSP) stricte n'autorise que les
  scripts du launcher. Le HTML des notes de version est filtré, et seuls les liens `https://`
  s'ouvrent.
- **Aucune télémétrie**, aucune clé d'API, aucun serveur à nous : le launcher parle seulement à
  Microsoft, Mojang, Modrinth, Forge, NeoForge, Fabric, Quilt, GitHub (Horizon) et à ton Discord
  local.

## Signaler une faille

N'ouvre pas d'issue publique : utilise **Security › Report a vulnerability** sur le dépôt GitHub.
