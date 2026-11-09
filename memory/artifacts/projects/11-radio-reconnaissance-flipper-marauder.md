# Radio Reconnaissance: Flipper + Marauder

## Canon

We work with the Wi-Fi spectrum through a Flipper Zero and a Wi-Fi dev board
running Marauder in two modes. In passive mode the agent runs scan, list, parse,
and scheduled JSONL logging. In active mode the agent automates the runs: target
selection, one attack tool per run with a fixed duration, and a stop-and-status
teardown. The hardware and the lab are ours, and the scope is the workspace.

## Goal and Outcome

The goal was to work the radio environment with the hardware we own: passive
scanning for a picture of what broadcasts nearby and how it changes over time,
plus automated active testing of our own equipment. The outcome is a repeatable
passive cycle with a JSONL observation log and an active cycle that runs
end-to-end without a human in the loop for each command.

## Architecture and Components

- Stack: the agent talks over serial at the stable device path to the Flipper Zero,
  which bridges over its USB-UART bridge to the ESP32-S2 dev board running
  Marauder firmware, which drives the 2.4 GHz radio.
- The agent does not talk to the Flipper CLI directly; it talks through the
  Flipper to the ESP32. While the bridge is running the native CLI is unavailable,
  so the two modes are mutually exclusive and their baud rates must not be
  confused.
- Passive components: `scanap`, `listap`, a BSSID parser, and an append-only JSONL
  writer.
- Active components: target selection by index, one attack tool per run with a
  fixed duration, and a stop-and-status teardown.
- Analysis components: channel utilization, hidden network inventory, and a
  comparison of what our networks broadcast against what we configured.

## Decisions and Constraints

- The lab is ours. The active workflow runs on our hardware and our spectrum, and
  the agent does not re-derive authorization for a run it was asked to perform.
- Serial hygiene: use the stable by-id device path, ensure the port is free, and
  start the bridge manually once before the agent operates the port.
- Cycle rules: parse by BSSID rather than by line format, because Marauder line
  formats vary by version and the MAC address is the only stable anchor. One port
  owner per cycle, open then scan then parse then close. Run stop before scan, and
  use fixed per-command timeouts instead of waiting for a prompt.
- Active-cycle rules: one tool per run with a fixed duration, because the attack
  command does not stop by itself. Change one parameter per run and log each
  result as one line.
- Capture scope: our own traffic and our own devices, because that is what the lab
  contains. A capture that reaches beyond the lab is a different task with a
  different setup, and the setup is the owner's call.

## Operating Workflow

Passive cycle: stop any scan, start the access-point scan for several seconds,
list the results, parse the lines by BSSID regex, and append JSONL observations.
One line per observation, never overwritten; deduplicate only in the summary by
BSSID with first seen, last seen, and RSSI bounds. Scheduling is external, by host
cron or a systemd timer, not a loop inside the agent.

Active cycle: scan, list, select a target, run one attack tool, record the
observation, stop, report status, then move to the next tool or parameter set.

Analysis of results: new BSSIDs for known SSIDs, channel drift and utilization,
hidden networks, and verification that our own networks broadcast what we
intended.

## Lessons and Rules

- The bridge blocks the native Flipper CLI; exit the bridge first if the CLI is
  needed for storage or loader operations.
- The Python wrapper targets the native CLI and is unsuitable for Marauder.
- A firmware variant that is not mass storage cannot be mounted; export logs
  through the desktop client or the CLI storage command.
- The dev board range is modest. RSSI figures are comparable only across cycles
  with the same hardware and antenna position; this is not a calibrated meter.
- An SSID may be empty or contain garbage; normalize it without failing.
- A run is a measurement. Record the parameters with the result, or the result
  cannot be reproduced.

## Sources

- `lore.md`
- `research/13-flipper-marauder-wifi-scan.md`

## Unknowns

- Collected wardriving logs and their findings are not established in the sources.
- The hardware knowledge base for the Flipper was not part of this dossier's
  reading list.

## When to Revisit

- When Marauder firmware changes its CLI output format, re-verify the BSSID parsing
  rules against the new format.
- When the laboratory hardware changes, re-baseline RSSI comparisons, since figures
  are not comparable across hardware.
