# DAS · Loot & Trade (`darsh-loot`)

Part of **Darshyne's Automation Suite (DAS)**. Loot and trade for **Foundry VTT V14** and **dnd5e 6.x**, with a
Baldur's Gate 3-style interface:

- **lootable corpses** out of combat, with treasure rolled on the first search according to the creature's CR
  and treasure theme;
- **containers**: a "Container" region behavior, contents rolled from a table or from a treasure hoard by CR
  band, locks (key, thieves' tools or GM), hover cursor;
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

The module ships in **English** and **French**. To add a language:

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
