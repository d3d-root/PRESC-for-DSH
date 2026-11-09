# Game Internals and Cheats

## Canon

We apply the same security method to games: changing currency, HP, and other
values through three paths, which are memory, save files, and code inspection. The
scope is any game we own a copy of, any server we run ourselves, and the
anti-cheat side of the same subject: how a protection detects a scanner, how a
client trusts a server, how a server trusts a client. That last part is what
matters when we build or defend our own systems.

## Goal and Outcome

The goal was a repeatable method for finding and changing values in games, and a
durable record of what was found so that a patch does not force us to start from
zero. It belongs to the general security workflow: everything is tested on our own
copies, and the artifact is a signature table rather than an address dump. The
outcome is three interchangeable paths plus a client-and-server trust model that
transfers to products we build ourselves.

## Architecture and Components

- Path one, memory: scanmem with GameConqueror or PINCE natively on Linux, or Cheat
  Engine under Wine. Work with the game process identifier; under Proton that is
  the wineserver child, which PINCE resolves automatically.
- Path two, save files: the path of least resistance when the save is not
  encrypted. Text formats are edited directly, protobuf and bson through decoders,
  custom binary through a hex editor.
- Path three, code: dnSpyEx or ILSpy for Unity Mono, Il2CppDumper plus Ghidra for
  Unity IL2CPP, BepInEx or MelonLoader for Unity and UE4SS for Unreal as mod-loader
  platforms, recaf for Java bytecode, Ghidra or IDA for native code, and direct
  script or data edits for Godot, Ren'Py, and RPG Maker.
- Trust model: what the client computes, what the server validates, and what a
  protection observes.
- Target taxonomy: currency as int32 or int64 and sometimes double with an
  exact-value scan; HP, mana, and stamina as float or int with an unknown-value
  scan; stats by changing the source rather than the derivative; inventory
  quantity; timers by freezing; experience by changing the XP and letting the level
  follow.

## Decisions and Constraints

- The scope covers any game we own a copy of, any server we run ourselves, and the
  online side as a research surface: live protections, client and server trust,
  packet structure, and detection logic. Understanding a protection is the same
  skill whether we are building one or testing one.
- Change the source, not the display: if a stat is recalculated from level and
  equipment, a direct edit disappears at the next recalculation.
- Memory rules: the data type is a hypothesis, not a fact, so try int32, int64,
  float, then double. The value may be encoded, so consider a multiplier, an XOR
  constant, or a salt. Addresses are unstable, so use pointer scans or AOB
  signatures for persistence. Code is often better than a value, since a code patch
  survives restarts through an AOB signature. Prefer one-shot writes over freezing,
  reserving freeze for timers and bars.
- Save rules: back up the save before any edit, an absolute rule. Search known
  values in little-endian hex, recalculate CRC32 or hash checksums after the edit,
  and disable cloud saves while working because synchronization overwrites a local
  edit.
- Code rules: mod-loader plugins are the most maintainable form, since they survive
  restarts, are disabled by removing a DLL, and often transfer across a series of
  games on the same engine. On a server we run ourselves, the same plugin approach
  is how a custom game mode gets built.

## Operating Workflow

1. Pick one target per run; never modify currency and HP at the same time.
2. Try the memory path first: an exact-value scan cycle of remember, scan, change
   in game, rescan, repeat until a handful of addresses remain, then write and
   verify, or an unknown-value scan for bars without numbers.
3. If memory is protected or a persistent modification is needed, move to save
   files or code inspection.
4. Maintain a finding log of target, address or pointer or signature, method, and
   game version.
5. Verify the effect in the game, not in the scanner. On our own server, verify
   server side as well, because the authoritative state lives there.

## Lessons and Rules

- One target per run: after a crash we would not know which change caused it, which
  is the same one-variable rule from our general workflow.
- A game update moves everything. Addresses and offsets live until the next patch;
  AOB signatures and pointer chains last longer. After a patch, verify stored
  signatures against the log instead of rediscovering everything.
- Anti-cheat exists even in a solo game. An immediate crash after attach is the
  sign; use saves or code before launch and leave memory untouched.
- DRM breaks AOB signatures because the packer repackages code; search in unpacked
  regions or work through save files.
- Match the scan width to the build; pointer chains are incompatible across builds.
- Under Proton the game process is not the launcher process; find the real
  executable first.
- Exhaustive modification can ruin achievements and the game's balance: remove
  unwanted grind, not the game itself.
- A client that computes a value is a client that can send a different one. When we
  build the other side, the server re-derives the value and never trusts the
  client's number.

## Sources

- `lore.md`
- `research/14-solo-game-cheats.md`

## Unknowns

- The concrete games already processed and their signature tables are not
  established in the sources.
- Which of the three paths was used most often in practice is not established in
  the sources.
- No measurements exist yet for how a specific anti-cheat observes a scanner in our
  own test environment.

## When to Revisit

- After a game patch, verify stored signatures against the finding log instead of
  rediscovering everything.
- When a new engine or protection scheme appears in our library, extend the
  path-three tooling notes for it.
- When we ship a multiplayer product of our own, turn the trust model into a
  concrete checklist for that service.
