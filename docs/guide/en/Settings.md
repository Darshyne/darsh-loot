# Settings

*[Version française](Reglages)*

The DAS · Loot & Trade settings have their own window: **Settings → Configure Settings → DAS · Loot & Trade → Open settings**. It has
four tabs (**Searching**, **Loot & theft**, **Containers**, **Traps**), a search by name or help, and separates the settings **for
the whole table** (chosen by the GM) from those **for this computer** (each player sets their own). It is the same window as DAS ·
Core's; with a DAS · Core older than 0.241.0, the settings stay in Foundry's list.

![The settings window, Containers tab](images/en/reglages-fenetre.webp)

This page details the tabs that concern containers and traps. The **Loot & theft** tab sets up bodies (who searches them, rolled
treasure, humanoid pockets, announcing what is taken) and pickpocketing.

## Searching

| Setting | Default | What it does |
|---|---|---|
| **Left-click looting** *(setting for this computer)* | Never | What a left click on a body, a chest, a pile, a merchant or a spotted trap does, out of combat. **Never**: the click stays Foundry's, the right-click menu offers "Search". **Only within reach**: the click opens what is within reach. **Walk there, then open**: the character walks within reach, then opens. The hover cursor stays in every case. |
| **Search reach** | 5 ft | Maximum distance, edge to edge, to search. |
| **Offer "Search the surroundings"** | Yes | The action in your own token's menu. Unticked, passive Perception still finds things. |
| **Search radius** | 15 ft | How far "Search the surroundings" looks (walls included). |
| **Search duration** | 10 s | Real seconds "Search the surroundings" takes out of combat (0: at once). |
| **Delay between searches** | 1 min | Before the same character can search again, out of combat (world time or real time, whichever runs out first). |

## Pickpocketing

**Stealing from an NPC (player).** Select your character (one token, your own), then **right-click the NPC** → **"Pickpocket"**. The
character walks up if too far, then the pockets window opens: each item with its difficulty (never the DC), worn items greyed out.
Clicking an item rolls Sleight of Hand. One try per item; a failure is seen and heard by the whole table. The entry is not offered on
a dead NPC ("Search" instead) or on a summon; **in combat** it stays visible with "(out of combat)" and only reminds the rule.

**Having an NPC steal from a character (GM).** Select the NPC's token, then **right-click the character** → **"Steal from …"**. The NPC
walks up if too far, then the GM window shows the character's pockets with the **exact DC** of each item (passive Perception, raised by
value and weight), worn items greyed out, and an **"At random"** button. The purse gives a handful (10 to 40% of each coin). The NPC's
Sleight of Hand is a **hidden roll**: on a success the item goes to the NPC flagged "stolen from …", only the GM gets the summary and the
player learns nothing (unless the setting says so); on a failure the whole table sees the card, the floating text over both tokens, the
ping, and hears the sound. A stolen item taken back from the NPC (from its corpse, or by pickpocketing it in turn) is clean again. For a
macro or another module: `game.modules.get("darsh-loot").api.npcSteal(npc, character, itemId | "coins" | "random")`.

| Setting | Default | What it does |
|---|---|---|
| **Pickpocketing** | On | **On**: players pickpocket freely. **Off**: the "Pickpocket" entry disappears and the GM refuses any attempt (even by macro). **GM approval**: each visit to the pockets waits for the GM's approval (one minute to answer; no answer means no). Thefts by the GM's NPCs do not depend on this setting. |
| **The player notices a successful theft** | No | When an NPC steals from a character, its player gets a private message. Otherwise only the GM is told. |
| **Caught thieves make enemies** | No | A player's failed theft makes the NPC hostile instead of merely wary. |

## Containers

| Setting | Default | What it does |
|---|---|---|
| **Size of placed objects (%)** | 80 | Chests, piles and traps placed by the module are drawn at most at this share of their squares. Display only. |
| **Drop items on the ground** | Yes | Dragging an item from a sheet onto the map drops it as a pile. |
| **Delete the store with its container** | No | Deleting a container also deletes its actor from "Loot — containers". |
| **Thrown weapons leave the hand** | Yes | A thrown weapon lands on the ground or stays stuck in the target. |
| **Generic container tables** *(GM tool)* | — | **"Create the tables"**: seven loot tables (chest, barrel, crate, bookshelf, desk, altar, camping bag) in "Loot — tables". Needs the Player's Handbook. |

## Traps

| Setting | Default | What it does |
|---|---|---|
| **Advanced trap mode** | Yes | Out of combat, a trap that goes off stops movement, starts a combat (Surprised if it wasn't spotted) and lets the GM give each creature Advantage or Disadvantage. Unticked: the trap strikes at once. |
| **Pause when a trap goes off** | Yes | In advanced mode, out of combat, the pause. Unticked: only movement stops. |
| **Disarm duration** | 5 s | Real seconds before the disarm roll (0: at once). |
| **Traps: object immunities** | Yes | A placed trap token gets the immunities of an object (Poison and Psychic damage, conditions except Invisible). Nothing is removed if you untick it. |
