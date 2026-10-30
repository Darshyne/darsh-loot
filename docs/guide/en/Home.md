# DAS · Loot & Trade — GM guide

*[Version française](Accueil)*

This guide explains how to place and set up, in a Foundry scene, what the characters search and what can blow up in their faces:
**containers** (chests, barrels, piles on the ground…) and **traps** (pressure plates, darts, trapped chests and doors).

It applies to DAS · Loot & Trade (`darsh-loot`) **0.18** and later, with DAS · Core (the combat engine), on Foundry V14 and dnd5e 6.

## Pages

- [Containers](Containers) — chests, piles on the ground, contents, treasure, lock, sound, hiding place.
- [Traps](Traps) — the three parts of a trap, the four ways to place one, detection, disarming, advanced mode.
- [Settings](Settings) — the module settings that concern containers and traps.

## In a nutshell

- **Everything you search is a region** of the scene, with the "DAS · Container" behavior. Its contents live in a Group actor the
  module creates and files in the "Loot — containers" actor folder.
- **A trap has three parts**: its **trigger** (what sets it off), its **area** (who it hits) and its **source** (where it strikes from).
  Each one can be hidden and found on its own.
- **Right-click** always offers the actions: "Search", "Disarm the trap", and, for the GM, "Set off the trap", "Reset the trap"… Left
  click only searches if the "Left-click looting" setting allows it.
- **Foundry's highlight key** (Alt by default), held out of combat, makes what you can search or use glow (gold: a hiding place already
  found). The GM also sees, in mauve, what is still hidden. A spotted trap is drawn in red at all times.

## What you need

- **DAS · Core** (`dnd5e-combat`), required: it resolves rolls, movement and the context menu.
- Optional but useful:
  - the **2024 Dungeon Master's Guide** (official module): its eight ready-to-place traps, the treasure tables;
  - the **2024 Player's Handbook** (official module): the seven generic container tables;
  - **Dice So Nice**: results wait for the 3D dice to stop;
  - **DAS · Animations**: trap and lock animations.
