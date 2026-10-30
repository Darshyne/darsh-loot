# Traps

*[Version française](Pieges)*

A DAS trap is **an actor that "casts" an activity** — a saving throw against darts, an attack roll from a blade — at the creatures
standing in the wrong place. The combat engine resolves everything: rolls, damage, conditions. The module decides when the trap goes off,
on whom, and how the characters find and disarm it.

![A spotted trap: trigger and source in red, area in orange](images/en/piege-repere.webp)

## The three parts of a trap

| Part | The question | Example |
|---|---|---|
| **Trigger** | What sets it off? | The flagstone you step on, the lid you lift. |
| **Area** | Who is hit? | The corridor swept by the flames. Often the flagstone itself. |
| **Source** | Where does it strike from? | The holes in the wall, the fire-breathing statue. |

- All three can be in the same place (a hidden pit: you step on it, you fall in) or in three different places.
- The trigger and the source **are found separately**, each with its own DC: finding the holes in the wall doesn't tell you which
  flagstone not to step on.
- Once the source is spotted, the area shows too (in orange): you know where not to stand.

## The trap actor and its activity

A trap needs an **actor** carrying the activity to cast:

- one of the **eight traps of the 2024 Dungeon Master's Guide** (official module, actor compendium): ready to place, with one activity per
  level tier (1–4, 5–10, 11–16, 17–20). Their DCs (detection, disarming) are read automatically from their description;
- or **any home-made NPC**: a creature of type "Trap", or any NPC on which you tick "Trap".

> **Disarm DC 1?** That is on purpose. A Dungeon Master's Guide trap whose text calls for a Sleight of Hand check (the poisoned
> needle, DC 15) gets that DC, and a failure sets it off. The ones you neutralize without a roll once spotted (an iron spike wedged
> under a pit's lid, a trip wire to cut, holes to plug) get a DC of 1, and a failure does nothing. Change these values in the trap's
> settings if your table rules otherwise.

The **Activity** field is a list: pick the actor's activity to cast, or **"By the targets' level"** — the module then takes the Dungeon
Master's Guide tier that contains the targets' level (the highest character, otherwise the highest CR).

## Four ways to place a trap

### 1. A trap token (the simplest)

Drag a trap actor (a Dungeon Master's Guide trap, for instance) **onto the map**, where the trap is. **The placed token is the trap**:

- it is **hidden from players**, with a secret disposition;
- the module places a **region of its squares** under it (named "… (DAS · Trap)"), which follows it when moved and goes away with it:
  that is its default trigger and area;
- it goes off when a creature **enters its squares**, and hits the creatures in its squares;
- for the engine it is an **object**, not a creature: it doesn't block the way, can't be heard, is never caught in a spell area, has no
  "Pickpocket"; it gets the **immunities of an object** (Poison and Psychic damage, and the conditions an object can't have);
- it shows once it has gone off or been spotted.

To set it up: token window, **Identity** tab, **"DAS · Trap"** section. Set on the actor's **prototype token**, the settings are copied to
every placed token; each placed token then keeps its own state (armed, found, disarmed…). A trigger or an area elsewhere (another region)
is chosen on a placed token, with **"Pick on the map"**.

![The "DAS · Trap" section of the token window](images/en/piege-token-reglages.webp)

### 2. An area trap (region)

For a trap that hits a larger area than its flagstone, or whose source is elsewhere:

1. Draw the **area** as a region (the corridor).
2. Add the **"DAS · Trap"** behavior to it and choose the **trap actor** and its **activity**.
3. **Trigger**: empty, it is the area itself; otherwise, draw the flagstone as a region and choose it with **"Pick on the map"**. The
   module adds a small **"DAS · Trap trigger"** behavior to it by itself: nothing to set there.
4. **Source** (optional): a region or a tile of the scene (the statue), picked on the map.

You can also start from a tile (a drawn flagstone): tile HUD → **"Create a DAS zone shaped like this tile"** → **Trap**.

### 3. A trapped chest

In a **"DAS · Container"**'s settings, **Trapped container** section, tick **Trapped**, then choose the actor and the activity.

- **Goes off**: on opening (the lid you lift, the lock that gives), on a failed lock pick, or both.
- **Area**: empty, only whoever opens it is hit; otherwise a region, even far from the chest (the dart wall opposite).
- Once spotted, the chest glows red, and opening it first asks: **Disarm**, **Open anyway** or give up.

### 4. A trapped door

In a **door wall**'s window, **"DAS · Trapped door"** section: the same settings as the chest (you can drop an actor on the "Trap actor"
field).

- It goes off when the door **opens** (click on the door, or the engine menu's "Open" / "Force"), and/or on a **failed pick** of the
  DAS · Core lock.
- With no area, it hits whoever opens it (the token closest to the door).
- Once spotted, the door is drawn in red along the wall.

![The "DAS · Trapped door" section of the wall window](images/en/porte-piegee.webp)

## A trap's settings

The settings window is split into sections: **Trap**, **Area**, **Source**, **Trigger**, **Arming and disarming**.

![The "DAS · Trap" window in sections](images/en/piege-reglages.webp)

| Field | What it does |
|---|---|
| **Trap actor**, **Activity** | What strikes (see above). |
| **Initiative** | Its place in initiative in advanced trap mode (20 by default; less for a slow trap). |
| **Minimum size** | The smallest creature that sets it off. **Small** by default: a rat or a Tiny familiar walks over it. |
| **Height** | Above the floor, a token doesn't trigger it: a creature flying higher passes. 0: only what touches the floor. |
| **Armed** | Unticked: the trap doesn't go off. Tick it again to re-arm it by hand. |
| **Re-arming** | **Never**, **By hand (GM)** or **After a delay** (in minutes of world time). |
| **Disarm DC** | The thieves' tools check to disarm it (15 by default). |
| **Failed disarm** | **Nothing**, or **The trap goes off** (default). |
| **Disarmed** | Ticked after a successful disarm. Untick it (and tick "Armed") to set it again. |
| **Hidden trigger** / **Hidden source** | How each part is found: skill (Perception or Investigation), DC, passive distance, search radius, "Found", discovery text. |

Distances are in feet, converted automatically on a metric scene.

## Finding a trap

- **In passing** (passive Perception): a character who comes within the **passive distance**, **in line of sight**, finds the hidden part
  if their passive score reaches the DC. The whole table sees a card "X notices something", a text over the token, and hears a sound; the
  details are whispered to the player.
- **By searching**: right-click your own token → **"Search the surroundings"**. Out of combat, the search takes **10 s** (a gauge over the
  token, seen by all; moving interrupts it), then the GM rolls the dice in secret. **There is always a roll, even with nothing to find**:
  players can't tell. In combat, it costs the action. One minute separates two searches by the same character.
- **Spotted**: the trigger and the source are drawn **in red**, at all times (in combat too), and the area **in orange** once the source is
  found. The engine's path **avoids** a spotted trigger. A spotted trap is only drawn when it is in the player's view.

> The same system finds **secret doors** — in a wall's window, **"DAS · Hidden"** section (a secret door becomes an ordinary door once
> found; a hidden wall stops blocking sight) — and containers' **hiding places**.

## Disarming

- Right-click the spotted trap (its token, its square, the chest, the door) → **"Disarm the trap"**. The character first walks up to it if
  too far.
- The player confirms, then disarming takes **5 s** (gauge over the token, tool sounds; moving interrupts it), then their thieves' tools
  check is rolled.
- The result waits for the 3D dice: success, failure, or **set off** if the failure makes the trap go off. The whole table sees it (card,
  text over the token) and hears it.

![The disarm gauge over the token](images/en/desamorcage.webp)

## When it goes off

### Simple mode

**"Advanced trap mode"** unticked: the trap strikes **at once**, and the engine resolves the save or the attack against each creature in
the area.

### Advanced mode (default)

Out of combat, when a trap goes off:

1. **Movement stops**, and the game **pauses** ("Pause when a trap goes off" setting; unticked, only movement stops).
2. A **combat** starts with the scene's player characters and whoever set it off. If nobody had spotted the trap, the characters are
   **Surprised**.
3. The trap takes its place in initiative (20 by default), as an event.
4. On its turn, the GM gets a window: for each creature **in the area at that moment**, **Advantage**, **Normal** or **Disadvantage**
   depending on what the players did, or remove it; choose the level tier, then **"Launch the trap"**.

In combat, the window opens at once, without rolling initiative again.

![The GM window in advanced mode](images/en/piege-fenetre-mj.webp)

## The GM menu

Right-click (GM) a trap — its token, its square, its door, its chest — even hidden:

- **Set off the trap** — fire it by hand;
- **Reset the trap** — armed, not disarmed, trigger and source hidden again;
- **Disarm (GM, no roll)**;
- **Show the trap to players** / **Hide the trap from players**;
- **Trap settings**.

## Good to know

- A trap only goes off with a **character**: the GM opening a chest with no token selected sets nothing off.
- "After a delay" re-arming counts in **world time**: you need a running clock (a calendar module, or DAS · Core's real-time clock).
- Trap tokens are drawn at 80 % of their square ("Size of placed objects" setting); their trigger keeps its squares.
