# Just One

**Un mot à faire deviner. Un indice chacun. Sans avoir la même idée que les autres.**

👉 **Jouer : https://just-one-3bg0.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu coopératif multijoueur en ligne, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Just One* de Ludovic Roudy et Bruno Sautter (Repos Production ; projet de fans, non officiel, avec ses propres visuels et sa propre liste de mots).

## Règles en bref

- De 3 à 10 joueurs, tous dans le même camp. Une partie compte 13 cartes.
- À chaque carte, un joueur devine, à tour de rôle : il est le seul à ne pas voir le mot.
- Les autres écrivent chacun **un indice d'un seul mot**, sans se concerter. Un nombre, un sigle, une onomatopée ou un symbole comptent pour un mot.
- On compare : **les indices identiques s'effacent**, comme ceux de la même famille que le mot, sa traduction, un mot inventé ou qui se prononce pareil.
- Celui qui devine voit ce qui reste et donne **une seule réponse**, ou passe.
- **Trouvé** : la carte est gagnée. **Raté** : cette carte et la suivante sont perdues (sur la dernière carte, une carte gagnée s'en va). **Passé, ou tout effacé** : seule cette carte est perdue.
- **À 3 joueurs, chacun écrit 2 indices.**
- Score : 13 parfait, 12 incroyable, 11 excellent, 9-10 très beau, 7-8 dans la moyenne, 4-6 bon début, 0-3 à retenter.

Sont des choix de ce jeu :

- **La réponse à voix haute, ou à l'écrit**, au choix de l'hôte. À voix haute (par défaut), autour d'une table ou en appel : celui qui devine parle, les autres touchent « Trouvé » ou « Raté ». À l'écrit, il tape sa réponse et l'appli vérifie (accents, article, pluriel et petite faute ne comptent pas). Les indices, eux, s'écrivent toujours dans l'appli : ils doivent rester cachés et être comparés avant que celui qui devine les voie.
- **Pas de tirage du numéro de 1 à 5** de la boîte : il ne change rien à la partie. C'est un appui de moins à chaque carte.
- **Les doublons s'effacent d'office**, puis la table a le dernier mot : d'un toucher, on rétablit un indice effacé à tort ou on en efface un que l'appli n'a pas repéré. Ce contrôle humain reste nécessaire : l'appli ne sait pas qu'un mot est une traduction ou un mot inventé.
- **Le verdict se rectifie** sur l'écran de résultat (« c'était le même mot ! »), et le décompte des cartes suit.
- **« Je ne connais pas ce mot »** : n'importe qui peut en demander un autre, tout le monde est prévenu.
- **Deux longueurs** : 13 cartes, ou 7 pour aller vite. Le palier de fin est ramené au barème sur 13.
- **Chrono facultatif** : 45 ou 90 secondes pour écrire, sans limite par défaut. L'hôte peut aussi ne plus attendre un joueur distrait.
- **On n'attend pas les absents** : au bout de 20 secondes de coupure, un joueur ne bloque plus la carte. Les retardataires s'assoient et jouent tout de suite.
- **Thèmes au choix** dans une liste de plus de 1 300 mots écrite pour ce jeu. Les mots ne reviennent pas à une même table avant d'avoir fait le tour de la liste.
- De 3 à 10 joueurs, au lieu de 3 à 7 dans la boîte : en ligne, rien n'empêche d'être plus nombreux.

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code ; un lien reçu ne demande que le prénom
- Direction artistique « tableau blanc » : chaque joueur a son feutre, ses indices sont sur de petits tableaux à sa couleur, le mot est surligné au fluo, et une éponge efface les doublons
- Celui qui devine est **de nuit, les yeux fermés**, et voit seulement les autres écrire ; quand vient le moment de répondre, ses paupières s'ouvrent sur les tableaux qui restent
- L'écran prend la couleur du moment : bleu pour écrire, nuit pour celui qui devine, vert ou rouge pour le résultat
- Refus immédiat d'un indice de deux mots ou du mot lui-même, avertissement s'il est trop proche, et touche Entrée du clavier pour l'envoyer
- Confirmation en deux appuis pour les gestes sans retour (passer, terminer, quitter)
- Fin de partie : score, palier, confettis si c'est mérité, âmes sœurs, coup de maître, et toutes les cartes de la partie
- L'écran reste allumé pendant la partie, reprise automatique après une coupure, réactions, règles consultables en jeu
- Sons synthétisés et vibrations, animations réduites si le système le demande
- Aucune aide au calcul pendant la partie

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3160
npm run dev:client   # interface sur http://localhost:5196
npm test             # comparaison des mots, carte, réponse, pioche, table, liste de mots, barème
npm run build && npm run e2e   # une partie à voix haute et une à l'écrit, avec de vrais clients connectés
```

`JO_FAST=1` raccourcit le délai d'absence et le chrono (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur, comparaison des mots, barème
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), liste de mots (`words.ts`), table et minuteries (`room.ts`). Le serveur fait autorité : celui qui devine ne reçoit ni le mot ni les indices avant la fin de la comparaison, et jamais le texte d'un indice effacé avant le résultat
- `client/` : React + Vite, animations en CSS. La partie est dans `screens/Table.tsx`, le salon dans `screens/Lobby.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
