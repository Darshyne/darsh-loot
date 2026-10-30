# Réglages

*[English version](Settings)*

Les réglages de DAS · Loot & Trade sont dans leur propre fenêtre : **Paramètres → Configurer les paramètres → DAS · Loot & Trade →
Ouvrir les réglages**. Elle a quatre onglets (**Fouille**, **Butin et vol**, **Conteneurs**, **Pièges**), une recherche par nom ou par
aide, et sépare les réglages **pour toute la table** (choisis par le MJ) de ceux **pour ce poste** (chaque joueur règle les
siens). C'est la même fenêtre que celle de DAS · Core ; avec une version de DAS · Core antérieure à 0.241.0, les réglages restent
dans la liste de Foundry.

![La fenêtre de réglages, onglet Conteneurs](images/fr/reglages-fenetre.webp)

Cette page détaille les onglets qui touchent aux conteneurs et aux pièges. L'onglet **Butin et vol** règle les cadavres (qui les
fouille, trésor tiré, poches des humanoïdes, annonce de ce qui est pris) et le vol à la tire.

## Fouille

| Réglage | Par défaut | Ce qu'il fait |
|---|---|---|
| **Fouille au clic gauche** *(réglage de ce poste)* | Jamais | Ce que fait un clic gauche sur un cadavre, un coffre, un tas, un marchand ou un piège repéré, hors combat. **Jamais** : le clic reste celui de Foundry, le clic droit propose « Fouiller ». **Seulement à portée** : le clic ouvre ce qui est à portée. **Y aller, puis ouvrir** : le personnage marche jusqu'à portée, puis ouvre. Le curseur de survol reste dans tous les cas. |
| **Portée de fouille** | 5 ft | Distance maximale, de bord à bord, pour fouiller. |
| **Proposer « Fouiller les environs »** | Oui | L'action dans le menu de son propre token. Décoché, la Perception passive trouve toujours. |
| **Rayon de fouille** | 15 ft | Jusqu'où « Fouiller les environs » cherche (murs compris). |
| **Durée d'une fouille** | 10 s | Secondes réelles que dure « Fouiller les environs » hors combat (0 : aussitôt). |
| **Délai entre deux fouilles** | 1 min | Avant qu'un même personnage puisse refouiller, hors combat (temps du monde ou temps réel, le premier écoulé). |

## Conteneurs

| Réglage | Par défaut | Ce qu'il fait |
|---|---|---|
| **Taille des objets posés (%)** | 80 | Coffres, tas et pièges posés par le module se dessinent au plus à cette part de leurs cases. Affichage seulement. |
| **Poser des objets au sol** | Oui | Glisser un objet d'une fiche sur la carte le pose en tas. |
| **Supprimer le coffre avec son conteneur** | Non | Supprimer un conteneur supprime aussi son acteur de « Butin — conteneurs ». |
| **Les armes de jet quittent la main** | Oui | Une arme lancée tombe au sol ou reste plantée dans la cible. |
| **Tables génériques de conteneurs** *(outil du MJ)* | — | **« Créer les tables »** : sept tables de butin (coffre, tonneau, caisse, bibliothèque, bureau, autel, sac de campement) dans « Butin — tables ». Il faut le Manuel des joueurs. |

## Pièges

| Réglage | Par défaut | Ce qu'il fait |
|---|---|---|
| **Mode piège avancé** | Oui | Hors combat, un piège qui part arrête les déplacements, lance un combat (Surpris s'il n'était pas repéré) et laisse le MJ donner Avantage ou Désavantage à chaque créature. Décoché : le piège frappe aussitôt. |
| **Pause quand un piège part** | Oui | En mode avancé, hors combat, la pause. Décoché : seuls les déplacements s'arrêtent. |
| **Durée d'un désamorçage** | 5 s | Secondes réelles avant le jet de désamorçage (0 : aussitôt). |
| **Pièges : immunités d'objet** | Oui | Un token piège posé reçoit les immunités d'un objet (dégâts de poison et psychiques, états sauf Invisible). Rien n'est retiré si vous décochez. |
