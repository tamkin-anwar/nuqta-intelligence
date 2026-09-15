# Nuqta Intelligence

Nuqta Intelligence is a cockpit for running several companies at once. The four businesses
are districts in a small Los Angeles basin, and every project you have running
with Claude — in a chat or in a Claude Code session — is a worker standing at
the company it belongs to. Walking means it is moving. Standing still and
pulsing amber means it is stuck. Click one and you land in the conversation
where that work is happening.

It was built as a personal instrument first, not a product: something to open in
the morning and see what is actually in flight across Anwar Logistics, Anwar
Capital, Anwar Autowerks and Anwar Creative Studio, without opening twelve tabs
to find out.

Built by Anwar Creative Studio.

**[Live demo →](https://tamkin-anwar.github.io/nuqta-intelligence/nuqta.html)** — opened outside Claude, the world renders but the board stays empty. See [How it works](#how-it-works) below for why.

## What it does

- **One worker per thread.** Every active project stands on its company's lot
  with its name over its head. A worker carrying a lit terminal is a Claude Code
  session; empty-handed is a chat. Anwar Ventures has no building, so its
  threads work the centre plaza.
- **Status you read from behaviour, not a label.** Walking is in flight. Still
  and pulsing amber is blocked, or gone quiet for more than seven days — the
  stillness is the signal. Pulsing green means the work is done and waiting on
  you. Shipped and parked workers are simply absent, so the world stays legible
  instead of filling with ghosts.
- **A board beside the world.** The same threads as rows, grouped by company and
  sorted by urgency, with shipped and parked collapsed behind a count. Open a
  row to change its status, mark it touched, or jump to the project.
- **Live business data.** Open deals read from HubSpot and appear as pillars on
  the Anwar Logistics lot. Countdowns to the 30 November validation gate and to
  the December wedding sit in the corner.
- **An inbox that counts people, not messages.** Outlook sits in a collapsed
  strip and separates real senders from `noreply@`, marketing infrastructure and
  automated mail, because an unread badge made of vendor noise is worse than no
  badge at all.
- **A day/night cycle.** Windows light up room by room after dark, signs and the
  pier come on, and the water catches the low sun.

## How it works

The whole thing is one self-contained HTML file. No build step, no bundler, no
model files — every building, tree, car and robot is generated from primitives
at load, because the page runs in a sandbox that can only load a script from a
handful of CDNs and nothing else.

`nuqta.html` is the source of truth, but the file is not where it runs. It is
published as a Claude artifact, and the published page is what gets a database
and connector access. Opening the file directly in a browser shows the world
and an empty board.

Rendering is three.js on an orthographic camera at true isometric elevation. The
core build ships no post-processing, so the bloom pass is written by hand:
render the scene to a target, pull the bright pixels at half resolution, blur
them across two separable passes, then composite with a vignette and a light
grade. That is what makes lit windows and signs read as light rather than as
pale paint.

## The sync

Claude's sandbox cannot read `~/.claude` — it is walled off on purpose — so the
reading happens on the Mac and Claude reads the output.

1. `sync/nuqta_sync.py`, run by launchd every fifteen minutes, walks
   `~/.claude/projects` and writes `~/NuqtaSync/sessions.json`.
2. `~/NuqtaSync` is connected to Claude as a folder.
3. A scheduled task reads that file each morning and writes the Claude Code
   projects onto the board.

To install, from this folder:

    bash sync/install.sh

That copies the script into `~/NuqtaSync/bin/`, runs it once, and schedules it.
This folder is the source; `~/NuqtaSync` is the install. To stop it:

    bash sync/install.sh uninstall

### Things that took several rewrites to get right

**A project is identified by its Claude Code directory name, never by `cwd`.**
`cwd` is recorded per event and is usually the folder a session was launched
from, which is often the parent. Trusting it silently collapsed five sibling
projects into a single row.

**Git worktrees fold into their parent repo.** Otherwise every throwaway
worktree becomes a project of its own named something like
`laughing-bassi-789f75`.

**`sync/ignore.txt` holds one substring per line.** Scrapped projects keep their
session history on disk forever, so without an ignore list the sync resurrects
them every morning.

**The sync never changes a status set by hand, and never deletes a row.** A
project that stopped appearing locally was probably archived, and losing a row
is worse than carrying a stale one.

**Failures are visible in the page, not swallowed.** Every database call was
originally wrapped in a silent catch, so a failed read looked identical to
having no work at all. The board sat empty for a day before that was caught.

## What it cannot do

claude.ai project chats have no API. There is no way to list them, so those rows
are added by asking Claude in any conversation — "add a workstream for X under
Anwar Capital" — and any conversation can read and write the same board. Only
the Claude Code side syncs itself.

## Tech stack

- three.js r128, loaded as a single UMD script
- Procedural geometry throughout; canvas textures for every label, sign and
  facade, with a per-shape cache so a few hundred window bays do not become a
  few hundred textures
- Hand-written post-processing: bright pass, two-pass gaussian, composite
- Claude artifact runtime for the shared database and for the HubSpot and
  Microsoft 365 connectors
- Python 3 and launchd for the local sync, no dependencies outside the standard
  library

## Name

*Nuqta* is the dot. The brass nuqta at the centre of the Anwar mark is where the
name came from, and Nuqta Intelligence LLC is the entity it belongs to.
