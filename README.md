# DAS · Loot & Trade (`darsh-loot`)

**[Website](https://darshyne.github.io)** · **[Discord](https://discord.gg/PDSq8dYdTP)** (questions, bugs, ideas)

> **Beta.** Darshyne's Automation Suite is still in beta: not every spell and feature is covered yet, and things may change
> between versions. If something doesn't behave as it should, tell us on [Discord](https://discord.gg/PDSq8dYdTP) or
> [open an issue](https://github.com/Darshyne/darsh-loot/issues).

Part of **Darshyne's Automation Suite (DAS)**. Loot and trade for **Foundry VTT V14** and **dnd5e 6.x**, with a
Baldur's Gate 3-style interface:

- **lootable corpses** out of combat, with treasure rolled on the first search according to the creature's CR
  and treasure theme;
- **containers**: a "Container" region behavior, contents rolled from a table or from a treasure hoard by CR
  band, locks (key, thieves' tools or GM), hover cursor;
- **traps**: a "DAS · Trap" region behavior set on the trap's **effect area**, which names its **trigger** (a pressure
  plate elsewhere, or the area itself) and its **source** (a region or a tile: the holes in the wall), both picked on
  the map; and **trapped containers and doors** (set in the container's behavior or the door's wall configuration)
  that go off when opened and / or when picking the lock fails, on whoever opens them or on a remote effect area. The
  trap actor's activity (DMG 2024 traps work as they are) is resolved by the engine. Trigger and source are each
  hidden until found (passive Perception, in line of sight, or "Search the surroundings"), with their own DC; a found
  trigger is drawn in red and avoided by the engine's pathfinding, a found source in red with the effect area in
  orange; either can be disarmed with thieves' tools. A minimum creature size sets them off (Small by default: a rat
  walks over the plate). **Advanced trap mode** (world setting, on by default): out of combat, a trap pauses the game
  and starts a combat (player characters Surprised if nobody had spotted it), acting at its own initiative (20 by
  default) through the engine's initiative events; in combat, nothing is rerolled. When it strikes, the GM gives each
  creature in the area Advantage or Disadvantage according to how it was played, then launches it. Traps rearm never,
  by hand or after a delay in world time;
- **items dropped on the ground** (drag an item from a sheet onto the map), with a throw animation and sounds;
- **pickpocketing** (Sleight of Hand against passive Perception), stolen items are flagged;
- **necromancy**: a dead humanoid becomes a controlled skeleton or zombie;
- **merchants**: barter window, restocking, shops without a token; a macro converts Item Piles merchants.

It **requires the [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) engine**, called only through its
public API, and replaces Item Piles (declared as a conflict). Treasure data comes from the dnd5e system and the
installed compendiums: no book text is shipped.

## Installation

In Foundry (or on The Forge), *Install Module* → paste the manifest URL:

```
https://github.com/Darshyne/darsh-loot/releases/latest/download/module.json
```

From source: the Foundry module is the `module/` subfolder, to copy or link into `Data/modules/darsh-loot`.
Compendiums are not versioned: run `npm install` then `npm run packs`, with Foundry closed. Tests: `npm test`.

Under active development.

## Translations

The module ships in **English**, **French** and **Brazilian Portuguese** (pt-BR translation by Henrique, [@henriquebot](https://github.com/henriquebot)). Any key missing from a translation falls back to English. To add a language:

1. copy `module/lang/en.json` to `module/lang/<code>.json` (e.g. `de.json`) and translate the values — keep the keys
   and the `{placeholders}` as they are;
2. add an entry to `languages` in `module/module.json`, e.g.
   `{ "lang": "de", "name": "Deutsch", "path": "lang/de.json" }`.

Missing keys fall back to English. `npm test` checks that the English and French files have the same keys and that
every key used by the code exists.

## License

Code under the MIT license (see `LICENSE`).

This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC,
available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0
International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. This module is not
affiliated with, nor endorsed by, Wizards of the Coast.
