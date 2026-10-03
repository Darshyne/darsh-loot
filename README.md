# darsh-dnd · Butin et commerce (`darsh-loot`)

Butin et commerce pour **Foundry VTT V14** et **dnd5e 6.x**, interface façon Baldur's Gate 3 :

- **cadavres fouillables** hors combat, trésor tiré à la première fouille selon le FP et le thème de la créature ;
- **conteneurs** : comportement de région « Conteneur », contenu tiré d'une table ou d'un trésor par tranche de
  FP, serrures (clé, outils de voleur ou MJ), curseur au survol ;
- **objets posés au sol** (glisser un objet d'une fiche vers la carte), avec animation de lancer et sons ;
- **vol à la tire** (Escamotage contre Perception passive), objets volés marqués ;
- **nécromancie** : un humanoïde mort devient un squelette ou un zombi contrôlé ;
- **marchands** : fenêtre de troc, réassort, boutiques sans token ; une macro reprend les marchands Item Piles.

Il **requiert le moteur [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat)**, appelé uniquement par
son API publique, et remplace Item Piles (déclaré en conflit). Les données de trésor sont celles du système
dnd5e et des compendiums installés : aucun texte de livre n'est livré.

## Installation

Pas encore de version publiée : le module s'installe depuis les sources. Le module Foundry est le
sous-dossier `module/`, à copier ou lier dans `Data/modules/darsh-loot`. Les compendiums ne sont pas
versionnés : `npm install` puis `npm run packs`, Foundry fermé. Tests : `npm test`.

Interface en français. En développement actif.

## Licence

Code sous licence MIT (voir `LICENSE`).

Ce travail inclut des éléments du System Reference Document 5.2 (« SRD 5.2 ») de Wizards of the Coast LLC,
disponible sur https://www.dndbeyond.com/srd. Le SRD 5.2 est sous licence Creative Commons Attribution 4.0
International, disponible sur https://creativecommons.org/licenses/by/4.0/legalcode. Ce module n'est ni
affilié à Wizards of the Coast ni approuvé par elle.
