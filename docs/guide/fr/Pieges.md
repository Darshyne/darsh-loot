# Pièges

*[English version](Traps)*

Un piège de DAS est **un acteur qui « lance » une activité** — une sauvegarde contre des fléchettes, un jet d'attaque d'une lame — sur
les créatures qui se trouvent au mauvais endroit. Le moteur de combat résout tout : jets, dégâts, états. Le module, lui, décide quand
le piège part, sur qui, et comment les personnages le trouvent et le désamorcent.

![Un piège repéré : déclencheur et source en rouge, zone d'effet en orange](images/piege-repere.webp)

## Les trois parties d'un piège

| Partie | La question | Exemple |
|---|---|---|
| **Déclencheur** | Qu'est-ce qui le fait partir ? | La dalle sur laquelle on marche, le couvercle qu'on soulève. |
| **Zone d'effet** | Qui est touché ? | Le couloir que balaient les flammes. Souvent, la dalle elle-même. |
| **Source** | D'où frappe-t-il ? | Les orifices dans le mur, la statue qui crache le feu. |

- Les trois peuvent être au même endroit (une fosse cachée : on marche dessus, on tombe dedans) ou à trois endroits différents.
- Le déclencheur et la source **se trouvent chacun à part**, avec leur propre DD : trouver les orifices dans le mur ne dit pas sur
  quelle dalle il ne faut pas marcher.
- Quand la source est repérée, la zone d'effet se montre aussi (en orange) : on sait où il ne faut pas être.

## L'acteur piège et son activité

Le piège a besoin d'un **acteur** qui porte l'activité à lancer :

- un des **huit pièges du Guide du maître 2024** (module officiel, compendium d'acteurs) : prêts à poser, avec une activité par tranche
  de niveaux (1–4, 5–10, 11–16, 17–20). Leurs DD (détection, désamorçage) sont lus tout seuls dans leur description ;
- ou **n'importe quel PNJ fait main** : une créature au type « Trap » (ou « Piège »), ou n'importe quel PNJ dont vous cochez
  « Piège ».

Le champ **Activité** est une liste : choisissez l'activité de l'acteur à lancer, ou **« Selon le niveau des cibles »** — le module
prend alors la tranche du Guide du maître qui contient le niveau des cibles (le plus haut personnage, sinon le plus haut FP).

## Quatre façons de poser un piège

### 1. Un token piège (le plus simple)

Glissez un acteur piège (un piège du Guide du maître, par exemple) **sur la carte**, à l'endroit du piège. **Le token posé est le
piège** :

- il est **caché aux joueurs**, de disposition secrète ;
- le module pose sous lui une **région de ses cases** (avec un nom « … (DAS · Piège) »), qui le suit quand on le déplace et part avec lui :
  c'est son déclencheur et sa zone d'effet par défaut ;
- il part quand une créature **entre dans ses cases**, et frappe les créatures de ses cases ;
- pour le moteur, c'est un **objet**, pas une créature : il ne bloque pas le passage, ne s'entend pas, n'est jamais pris dans une zone
  de sort, n'a pas de « Voler » ; il reçoit les **immunités d'un objet** (dégâts de poison et psychiques, et les états qu'un objet ne
  subit pas) ;
- il se montre une fois parti ou repéré.

Pour le régler : fenêtre du token, onglet **Identité**, section **« DAS · Piège »**. Réglé sur le **token prototype** de l'acteur, le
réglage est recopié sur chaque token posé ; chaque token posé garde ensuite son propre état (armé, trouvé, désamorcé…). Un déclencheur
ou une zone d'effet ailleurs (une autre région) se choisit sur un token posé, avec **« Choisir sur la carte »**.

![La section « DAS · Piège » de la fenêtre du token](images/piege-token-reglages.webp)

### 2. Un piège de zone (région)

Pour un piège qui touche une zone plus grande que sa dalle, ou dont la source est ailleurs :

1. Dessinez la **zone d'effet** en région (le couloir).
2. Ajoutez-lui le comportement **« DAS · Piège »** et choisissez l'**acteur piège** et son **activité**.
3. **Déclencheur** : vide, c'est la zone d'effet elle-même ; sinon, dessinez la dalle en région et choisissez-la avec **« Choisir sur la
   carte »**. Le module lui ajoute tout seul un petit comportement **« DAS · Déclencheur de piège »** : rien à y régler.
4. **Source** (facultatif) : une région ou une tuile de la scène (la statue), choisie sur la carte.

Vous pouvez aussi partir d'une tuile (une dalle dessinée) : HUD de la tuile → **« Créer une zone DAS de la forme de cette tuile »** →
**Piège**.

### 3. Un coffre piégé

Dans les réglages d'un **« DAS · Conteneur »**, section **Coffre piégé**, cochez **Piégé**, puis choisissez l'acteur et l'activité.

- **Se déclenche** : à l'ouverture (le couvercle qu'on soulève, la serrure qui cède), au crochetage raté, ou les deux.
- **Zone d'effet** : vide, seul celui qui ouvre est touché ; sinon une région, même loin du coffre (le mur aux fléchettes en face).
- Repéré, le coffre brille en rouge, et l'ouvrir demande d'abord : **Désamorcer**, **Ouvrir quand même** ou **Renoncer**.

### 4. Une porte piégée

Dans la fenêtre d'un **mur-porte**, section **« DAS · Porte piégée »** : mêmes réglages que le coffre (vous pouvez glisser un acteur sur
le champ « Acteur piège »).

- Elle part quand la porte **s'ouvre** (clic sur la porte, ou « Ouvrir » / « Forcer » du menu du moteur), et / ou au **crochetage raté**
  de la serrure DAS · Core.
- Sans zone d'effet, elle touche celui qui ouvre (le token le plus proche de la porte).
- Repérée, la porte est tracée en rouge le long du mur.

![La section « DAS · Porte piégée » de la fenêtre du mur](images/porte-piegee.webp)

## Les réglages d'un piège

La fenêtre de réglages est rangée en sections : **Piège**, **Zone d'effet**, **Source**, **Déclencheur**, **Armement et désamorçage**.

![La fenêtre « DAS · Piège » en sections](images/piege-reglages.webp)

| Champ | Ce qu'il fait |
|---|---|
| **Acteur piège**, **Activité** | Ce qui frappe (voir plus haut). |
| **Initiative** | Sa place dans l'initiative en mode piège avancé (20 par défaut ; moins pour un piège lent). |
| **Taille minimale** | La plus petite créature qui le fait partir. **Petite** par défaut : un rat ou un familier Très petit passe dessus. |
| **Hauteur** | Au-dessus du sol, un token ne déclenche pas : une créature qui vole plus haut passe. 0 : seulement ce qui touche le sol. |
| **Armé** | Décoché : le piège ne part pas. Recochez pour le réarmer à la main. |
| **Réarmement** | **Jamais**, **À la main (MJ)** ou **Après un délai** (en minutes de temps du monde). |
| **DD de désamorçage** | Le test d'outils de voleur pour le désamorcer (15 par défaut). |
| **Échec du désamorçage** | **Rien**, ou **Le piège se déclenche** (par défaut). |
| **Désamorcé** | Coché après un désamorçage réussi. Décochez (et cochez « Armé ») pour le remettre en état. |
| **Déclencheur caché** / **Source cachée** | Comment se trouve chaque partie : compétence (Perception ou Investigation), DD, distance passive, rayon de fouille, « Trouvé », texte de découverte. |

Les distances sont en pieds, converties toutes seules sur une scène en mètres.

## Trouver un piège

- **En passant** (Perception passive) : un personnage qui arrive à la **distance passive**, **en ligne de vue**, trouve la partie cachée si
  sa valeur passive atteint le DD. Toute la table voit une carte « X remarque quelque chose », un texte au-dessus du token et entend un
  son ; le détail est chuchoté au joueur.
- **En cherchant** : clic droit sur son propre token → **« Fouiller les environs »**. Hors combat, la fouille dure **10 s** (une jauge
  au-dessus du token, vue de tous ; bouger l'interrompt), puis le MJ lance les dés en secret. **Il y a toujours un jet, même s'il n'y a
  rien à trouver** : les joueurs ne peuvent pas deviner. En combat, elle coûte l'action. Un délai d'une minute sépare deux fouilles d'un
  même personnage.
- **Repéré** : le déclencheur et la source sont dessinés **en rouge**, en permanence (même en combat), et la zone d'effet **en orange**
  une fois la source trouvée. Le chemin du moteur **évite** un déclencheur repéré. Un piège repéré n'est dessiné que s'il est en vue du
  joueur.

> Le même système trouve les **portes secrètes** : dans la fenêtre d'un mur, section **« DAS · Caché »** (une porte secrète devient une
> porte ordinaire une fois trouvée ; un mur caché cesse de bloquer la vue), et les **cachettes** des conteneurs.

## Désamorcer

- Clic droit sur le piège repéré (son token, sa case, le coffre, la porte) → **« Désamorcer le piège »**. Le personnage s'en approche
  d'abord s'il est trop loin.
- Le joueur confirme, puis le désamorçage dure **5 s** (jauge au-dessus du token, bruit d'outils ; bouger l'interrompt), puis son test
  d'outils de voleur est lancé.
- Le résultat attend la fin des dés 3D : réussi, raté, ou **déclenché** si l'échec fait partir le piège. Toute la table le voit (carte,
  texte au-dessus du token) et l'entend.

![La jauge de désamorçage au-dessus du token](images/desamorcage.webp)

## Quand il part

### Mode simple

Réglage **« Mode piège avancé »** décoché : le piège frappe **aussitôt**, et le moteur résout la sauvegarde ou l'attaque contre chaque
créature de la zone d'effet.

### Mode avancé (par défaut)

Hors combat, quand un piège part :

1. **Les déplacements s'arrêtent**, et le jeu se met **en pause** (réglage « Pause quand un piège part » ; décoché, seuls les
   déplacements s'arrêtent).
2. Un **combat** commence avec les personnages des joueurs de la scène et celui qui l'a déclenché. Si personne n'avait repéré le piège,
   les personnages sont **Surpris**.
3. Le piège prend sa place dans l'initiative (20 par défaut), comme un évènement.
4. À son tour, le MJ reçoit une fenêtre : pour chaque créature **dans la zone à ce moment**, **Avantage**, **Normal** ou **Désavantage**
   selon ce que les joueurs ont fait, ou la retirer ; il choisit la tranche de niveaux, puis **« Lancer le piège »**.

En combat, la fenêtre s'ouvre tout de suite, sans relancer l'initiative.

![La fenêtre du MJ en mode avancé](images/piege-fenetre-mj.webp)

## Le menu du MJ

Clic droit (MJ) sur un piège — son token, sa case, sa porte, son coffre — même caché :

- **Déclencher le piège** — le faire partir à la main ;
- **Réinitialiser le piège** — armé, pas désamorcé, déclencheur et source de nouveau cachés ;
- **Désamorcer (MJ, sans jet)** ;
- **Montrer le piège aux joueurs** / **Cacher le piège aux joueurs** ;
- **Réglages du piège**.

## Bon à savoir

- Un piège ne part qu'avec un **personnage** : le MJ qui ouvre un coffre sans token sélectionné ne déclenche rien.
- Le réarmement « après un délai » compte en **temps du monde** : il faut une horloge qui tourne (un module de calendrier, ou l'horloge
  en temps réel de DAS · Core).
- Les tokens pièges se dessinent à 80 % de leur case (réglage « Taille des objets posés ») ; leur déclencheur garde ses cases.
