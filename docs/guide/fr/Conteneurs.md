# Conteneurs

*[English version](Containers)*

Un conteneur, c'est tout ce qu'on fouille sur la carte et qui n'est pas un cadavre : un coffre, un tonneau, une bibliothèque, une
cachette sous une dalle, un tas d'objets tombés au sol.

![Un coffre posé et sa fenêtre de fouille](images/conteneur-fenetre.webp)

## Comment ça marche

- Un conteneur est une **région** de la scène qui porte le comportement **« DAS · Conteneur »**. La région, c'est l'endroit où
  l'on clique ; ce que voient les joueurs, c'est en général une **tuile** (l'image du coffre) posée dessus.
- Son **contenu** vit dans un **acteur Groupe** de dnd5e, créé tout seul à la création du conteneur et rangé dans le dossier
  d'acteurs **« Butin — conteneurs »**. Les joueurs n'ont aucun droit sur cet acteur et ne le voient pas dans leur barre d'acteurs :
  ils voient seulement la fenêtre de fouille.
- Pour remplir un coffre à la main, ouvrez la fiche de cet acteur (bouton **« Fiche du contenu »** dans la fenêtre de fouille, côté MJ)
  et glissez-y des objets et des pièces, comme dans n'importe quelle fiche.

## Quatre façons d'en poser un

### 1. Glisser un objet « conteneur » sur la carte (le plus rapide)

Glissez un objet dnd5e de type **conteneur** (Chest, Backpack, Barrel…) **depuis la barre des objets ou un compendium** sur la carte. Il
devient un **coffre posé** : une tuile à son image, au centre de la case, et sa région. Le coffre reçoit **le contenu du sac**
(objets et pièces), pas le sac lui-même.

> Glissé depuis la fiche d'un personnage, le même objet devient un **tas au sol** (voir plus bas) : le personnage le pose par terre.

### 2. Depuis une tuile de votre carte

Votre carte a déjà un coffre dessiné, ou vous avez posé une tuile de coffre ?

1. Sélectionnez la tuile, ouvrez son HUD (clic droit) et cliquez sur le bouton **« Créer une zone DAS de la forme de cette tuile »**.
2. Choisissez **Conteneur**, donnez un nom, **Créer**.
3. La région suit le **contour visible de l'image** (son rectangle si l'image ne se lit pas), et la fenêtre de réglages s'ouvre.

La tuile et la région restent liées : supprimer l'une supprime l'autre.

![Le bouton du HUD de tuile et la fenêtre « Tuile → zone DAS »](images/tuile-vers-zone.webp)

### 3. Convertir un token Groupe

Vous avez déjà un acteur **Groupe** rempli (le butin d'un repaire, un sac de campement), posé en token sur la carte ? Clic droit sur
le token (MJ) → **« Convertir en conteneur »**.

- Une tuile prend la place du token, **avec le même visuel** (image, échelle, miroir, teinte, opacité) et sa taille en cases.
- Le coffre reçoit une **copie** des objets du groupe (rangés dans les mêmes sacs) et de son argent. Rien n'est tiré en plus.
- Le token disparaît ; **l'acteur Groupe du monde reste**, vous pouvez le réutiliser.

### 4. Dessiner la région à la main

Outil Régions → dessinez une région → onglet Comportements → ajoutez **« DAS · Conteneur »**. Pratique pour une cachette sans image
(sous une dalle, dans un mur), souvent combinée avec la section **Cachette**.

## Les réglages d'un conteneur

La fenêtre de réglages est rangée en sections.

![La fenêtre de réglages d'un conteneur, en sections](images/conteneur-reglages.webp)

### Contenu

| Champ | Ce qu'il fait |
|---|---|
| **Nom** | Le titre de la fenêtre de fouille. Vide : le nom de la région. |
| **Contenu** | L'acteur Groupe qui porte les objets (créé tout seul). |
| **Table** et **Tirages** | Une table tirée **une fois, à la première ouverture**, autant de fois que « Tirages ». Les résultats peuvent être des objets liés, des liens `@UUID` d'objets dans le texte, ou un texte seul (qui devient un objet « butin » à ce nom). |
| **Trésor de repaire** | Un trésor de repaire aléatoire du Guide du maître 2024 selon la tranche de FP (0–4, 5–10, 11–16, 17+) : pièces et objets magiques, tirés une fois. |
| **Thème du trésor** | Tous, Arcanes, Armements, Instruments ou Reliques. Arcanes change les pièces en gemmes, Reliques en objets d'art ; les objets magiques sont tirés dans les tables de ce thème (Tous : au hasard). |
| **Déjà tiré** | Coché tout seul après le premier tirage. Décochez pour tirer de nouveau (le nouveau tirage s'ajoute). |
| **Propriétaire** | À qui appartient le contenu. Renseigné, tout ce qu'on y prend est **marqué volé** à ce nom. |

> **Tables prêtes à l'emploi** : dans les réglages du module, le bouton **« Créer les tables »** crée sept tables génériques (coffre,
> tonneau, caisse, bibliothèque, bureau, autel, sac de campement), faites d'objets du Manuel des joueurs, dans le dossier « Butin —
> tables ». Il faut le module Manuel des joueurs.

### Serrure

| Champ | Ce qu'il fait |
|---|---|
| **Verrouillé** | Le coffre s'ouvre avec la clé, des outils de voleur, ou par le MJ. |
| **DD de la serrure** | Le DD du test d'outils de voleur pour la crocheter. |
| **Clé** | Le nom de l'objet qui ouvre la serrure (sans tenir compte des majuscules). |
| **Son** | Le bruit du coffre qu'on ouvre et de sa serrure, choisi parmi les sons de portes de Foundry. **Porte en bois** par défaut ; « Aucun » : silencieux. |

Le contenu n'est tiré qu'une fois la serrure ouverte. Un crochetage raté ne coûte rien d'autre qu'un nouvel essai (sauf piège, voir
[Pièges](Pieges)).

### Cachette

Cochez **Cachée** pour que les joueurs ne voient ni n'utilisent le conteneur tant qu'un personnage ne l'a pas trouvé. Ses tuiles
restent cachées jusque-là.

| Champ | Ce qu'il fait |
|---|---|
| **Compétence** | Perception ou Investigation. |
| **DD de détection** | La valeur passive, ou le jet de fouille, à atteindre. |
| **Distance passive** | En pieds : un personnage qui arrive à cette distance, **en ligne de vue**, le trouve si sa valeur passive atteint le DD. 0 : pas de détection passive. |
| **Rayon de fouille** | Distance maximale pour « Fouiller les environs » (une aiguille ne se voit qu'à 5 ft). |
| **Trouvée** | Coché tout seul quand on le trouve. Décochez pour le recacher (les essais ratés s'effacent). |
| **Texte de découverte** | Ce que lit le joueur qui le trouve. |

Les distances sont en pieds et converties toutes seules sur une scène en mètres (5 ft = 1,5 m).

### Coffre piégé

Un conteneur peut aussi porter un piège qui part à l'ouverture ou au crochetage raté : voir [Pièges → coffres et portes
piégés](Pieges#coffres-et-portes-piégés).

## Côté joueurs

- **Survol** : au-dessus d'un conteneur, hors combat, le curseur change — une main pour fouiller, un cadenas s'il est verrouillé, « trop
  loin » hors de portée. Rien ne se trahit hors de vue : à travers un mur, le brouillard ou un toit, le curseur ne change pas.
- **Ouvrir** : clic droit sur la case → **« Fouiller »**. Le clic gauche le fait aussi si le joueur l'a permis (réglage « Fouille au
  clic gauche »).
- **La fenêtre de fouille** : un clic sur un objet le prend, **« Tout prendre »**, **« Prendre les pièces »**. Les pièces et
  les objets vont au personnage sélectionné.
- **Serrure** : la fenêtre propose « Ouvrir avec (la clé) » si le personnage l'a, « Crocheter (DD …) » s'il a des outils de voleur. Le
  joueur lance lui-même son test ; le résultat arrive après les dés 3D, avec une carte dans le chat, un texte au-dessus du token et le
  son de la serrure, pour toute la table.
- **Portée** : 5 ft par défaut (réglage « Portée de fouille »), de bord à bord. Le MJ n'a pas de limite de portée.

![Le curseur de fouille, le cadenas, et la fenêtre de serrure](images/conteneur-serrure.webp)

## Les tas au sol

- Un joueur **glisse un objet de sa fiche** sur la carte, à côté de son personnage : l'objet tombe dans un **tas** d'une demi-case, avec
  une petite animation de lancer et un bruit selon l'objet. Plusieurs objets dans la même case s'ajoutent au même tas.
- Un tas se fouille comme un coffre. **Vidé, il disparaît** (tuile et région).
- Un tas n'a pas de son de coffre, pas de serrure, pas de table.
- Les armes lancées avec le moteur de combat tombent aussi au sol (réglage « Les armes de jet quittent la main »).

## Bon à savoir

- **Taille à l'écran** : les coffres, tas et pièges posés par le module se dessinent à **80 %** de leurs cases (réglage « Taille des
  objets posés »), pour laisser de l'air autour. Seul l'affichage change : la zone de fouille garde ses cases. Les tuiles de votre carte
  transformées en zone ne changent pas.
- **Supprimer un conteneur** (sa région ou sa tuile) laisse son acteur dans « Butin — conteneurs », sauf si le réglage « Supprimer le
  coffre avec son conteneur » est coché.
- **En combat**, on ne fouille pas : le clic appartient au moteur de combat.
