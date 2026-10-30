# Containers

*[Version française](Conteneurs)*

A container is anything on the map you can search that is not a corpse: a chest, a barrel, a bookshelf, a hiding place under a
flagstone, a pile of items dropped on the ground.

![A placed chest and its search window](images/conteneur-fenetre.webp)

## How it works

- A container is a **region** of the scene carrying the **"DAS · Container"** behavior. The region is where you click; what players see
  is usually a **tile** (the chest's picture) on top of it.
- Its **contents** live in a dnd5e **Group actor**, created automatically with the container and filed in the **"Loot — containers"**
  actor folder. Players have no permission on that actor and don't see it in their actor sidebar: they only see the search window.
- To fill a chest by hand, open that actor's sheet (the **"Contents sheet"** button in the search window, GM side) and drop items and
  coins into it, like any other sheet.

## Four ways to place one

### 1. Drop a "container" item on the map (the fastest)

Drag a dnd5e item of type **container** (Chest, Backpack, Barrel…) **from the items sidebar or a compendium** onto the map. It becomes a
**placed chest**: a tile with its picture, centred on the square, and its region. The chest receives **the bag's contents** (items and
coins), not the bag itself.

> Dragged from a character sheet, the same item becomes a **pile on the ground** (see below): the character puts it down.

### 2. From a tile of your map

Your map already shows a chest, or you placed a chest tile?

1. Select the tile, open its HUD (right-click) and click the **"Create a DAS zone shaped like this tile"** button.
2. Pick **Container**, give it a name, **Create**.
3. The region follows the **visible outline of the picture** (its rectangle if the picture can't be read), and the settings window
   opens.

The tile and the region stay linked: deleting one deletes the other.

![The tile HUD button and the "Tile → DAS zone" window](images/tuile-vers-zone.webp)

### 3. Convert a Group token

You already have a filled **Group** actor (a lair's loot, a camping bag) placed as a token on the map? Right-click the token (GM) →
**"Convert to container"**.

- A tile replaces the token, **with the same look** (picture, scale, mirroring, tint, opacity) and its size in squares.
- The chest receives a **copy** of the group's items (kept in the same bags) and of its money. Nothing extra is rolled.
- The token goes away; **the world Group actor stays**, you can reuse it.

### 4. Draw the region by hand

Regions tool → draw a region → Behaviors tab → add **"DAS · Container"**. Handy for a hiding place with no picture (under a flagstone, in
a wall), often combined with the **Hiding place** section.

## A container's settings

The settings window is split into sections.

![A container's settings window, in sections](images/conteneur-reglages.webp)

### Contents

| Field | What it does |
|---|---|
| **Name** | The search window's title. Empty: the region's name. |
| **Contents** | The Group actor holding the items (created automatically). |
| **Roll table** and **Draws** | A table rolled **once, on first opening**, as many times as "Draws". Results can be linked items, item `@UUID` links in the text, or plain text (which becomes a "loot" item of that name). |
| **Treasure hoard** | A random treasure hoard from the 2024 Dungeon Master's Guide by CR band (0–4, 5–10, 11–16, 17+): coins and magic items, rolled once. |
| **Treasure theme** | Any, Arcana, Armaments, Implements or Relics. Arcana turns coins into gems, Relics into art objects; magic items are rolled on that theme's tables (Any: at random). |
| **Already rolled** | Ticked automatically after the first roll. Untick it to roll again (the new roll adds to the contents). |
| **Owner** | Who the contents belong to. When set, everything taken from it is **marked stolen** from that name. |

> **Ready-made tables**: in the module settings, the **"Create the tables"** button creates seven generic tables (chest, barrel, crate,
> bookshelf, desk, altar, camping bag), made of Player's Handbook items, in the "Loot — tables" folder. It needs the Player's Handbook
> module.

### Lock

| Field | What it does |
|---|---|
| **Locked** | The chest opens with the key, thieves' tools, or by the GM. |
| **Lock DC** | The DC of the thieves' tools check to pick it. |
| **Key** | The name of the item that opens the lock (case doesn't matter). |
| **Sound** | The noise of the chest opening and of its lock, chosen among Foundry's door sounds. **Wooden door** by default; "None": silent. |

The contents are only rolled once the lock is open. A failed pick costs nothing but another try (unless trapped, see [Traps](Traps)).

### Hiding place

Tick **Hidden** so players neither see nor use the container until a character finds it. Its tiles stay hidden until then.

| Field | What it does |
|---|---|
| **Skill** | Perception or Investigation. |
| **Detection DC** | The passive score, or search roll, to reach. |
| **Passive distance** | In feet: a character who comes this close, **in line of sight**, finds it if their passive score reaches the DC. 0: no passive detection. |
| **Search radius** | Maximum distance for "Search the surroundings" (a needle is only seen at 5 ft). |
| **Found** | Ticked automatically when found. Untick it to hide it again (failed attempts are cleared). |
| **Discovery text** | What the player who finds it reads. |

Distances are in feet and converted automatically on a metric scene (5 ft = 1.5 m).

### Trapped container

A container can also carry a trap that goes off on opening or on a failed pick: see [Traps → a trapped
chest](Traps#3-a-trapped-chest).

## On the players' side

- **Hover**: over a container, out of combat, the cursor changes — a hand to search, a padlock if it is locked, "too far" out of reach.
  Nothing gives itself away out of sight: through a wall, the fog or a roof, the cursor doesn't change.
- **Opening**: right-click the square → **"Search"**. Left click does it too if the player allowed it ("Left-click looting" setting).
- **The search window**: one click on an item takes it, **"Take all"**, **"Take the coins"**. Coins and items go to the selected character.
- **Lock**: the window offers "Open with (the key)" if the character has it, "Pick the lock (DC …)" if they have thieves' tools. The
  player rolls their own check; the result comes after the 3D dice, with a chat card, a text over the token and the lock's sound, for the
  whole table.
- **Reach**: 5 ft by default ("Search reach" setting), edge to edge. The GM has no reach limit.

![The search cursor, the padlock, and the lock window](images/conteneur-serrure.webp)

## Piles on the ground

- A player **drags an item from their sheet** onto the map, next to their character: the item falls into a half-square **pile**, with a
  small throw animation and a sound that fits the item. Several items in the same square join the same pile.
- A pile is searched like a chest. **Once empty, it disappears** (tile and region).
- A pile has no chest sound, no lock, no table.
- Weapons thrown with the combat engine also land on the ground ("Thrown weapons leave the hand" setting).

## Good to know

- **On-screen size**: chests, piles and traps placed by the module are drawn at **80 %** of their squares ("Size of placed objects"
  setting), to leave some room around them. Only the display changes: the search area keeps its squares. Map tiles turned into a zone are
  not changed.
- **Deleting a container** (its region or its tile) leaves its actor in "Loot — containers", unless the "Delete the store with its
  container" setting is ticked.
- **In combat**, you don't search: the click belongs to the combat engine.
