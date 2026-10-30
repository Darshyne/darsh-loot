# DAS · Loot & Trade — guide du MJ

*[English version](Home)*

Ce guide explique comment poser et régler, dans une scène Foundry, ce que les personnages fouillent et ce qui peut leur exploser au
visage : **les conteneurs** (coffres, tonneaux, tas au sol…) et **les pièges** (dalles, fléchettes, coffres et portes piégés).

Il vaut pour DAS · Loot & Trade (`darsh-loot`, butin et commerce) **0.18** et plus, avec DAS · Core (le moteur de combat), sur Foundry V14 et dnd5e 6.

## Les pages

- [Conteneurs](Conteneurs) — coffres, tas au sol, contenu, trésor, serrure, son, cachette.
- [Pièges](Pieges) — les trois parties d'un piège, les quatre façons d'en poser un, détection, désamorçage, mode avancé.
- [Réglages](Reglages) — les réglages du module qui concernent les conteneurs et les pièges.

## En deux mots

- **Tout ce qu'on fouille est une région** de la scène, avec le comportement « DAS · Conteneur ». Son contenu vit dans un acteur
  Groupe que le module crée et range dans le dossier d'acteurs « Butin — conteneurs ».
- **Un piège a trois parties** : son **déclencheur** (ce qui le fait partir), sa **zone d'effet** (qui il touche) et sa **source**
  (d'où il frappe). Chacune peut être cachée et se trouver à part.
- **Le clic droit** propose toujours les gestes : « Fouiller », « Désamorcer le piège », et, pour le MJ, « Déclencher »,
  « Réinitialiser »… Le clic gauche ne fouille que si le réglage « Fouille au clic gauche » le permet.
- **La touche de surbrillance de Foundry** (Alt par défaut), maintenue hors combat, fait briller ce qu'on peut fouiller ou utiliser
  (en or : une cachette trouvée). Le MJ voit aussi, en mauve, ce qui est encore caché. Un piège repéré, lui, est dessiné en rouge en
  permanence.

## Ce qu'il faut avoir

- **DAS · Core** (`dnd5e-combat`), obligatoire : il résout les jets, les déplacements et le menu contextuel.
- Facultatifs mais utiles :
  - le **Guide du maître 2024** (module officiel) : ses huit pièges prêts à poser, les tables de trésor ;
  - le **Manuel des joueurs 2024** (module officiel) : les sept tables génériques de conteneurs ;
  - **Dice So Nice** : les résultats attendent la fin des dés 3D ;
  - **DAS · Animations** : les animations des pièges et des serrures.
