# Nuqta

A 3D Los Angeles basin where the four companies are districts and every project
running with Claude is a worker standing at the company it belongs to.

Built as a personal cockpit first — something to run the businesses from — not a
product for anyone else.

Live: https://claude.ai/artifact/QND84HpReG3huSWMH2ec5x

## What's in here

    nuqta.html        the whole cockpit — one self-contained file
    sync/             the local job that keeps the board current
      nuqta_sync.py   reads ~/.claude/projects, writes sessions.json
      install.sh      installs it and schedules it every 15 minutes
      ignore.txt      starter ignore list (scrapped projects)

`nuqta.html` is the source of truth. It is published as a Claude artifact, which
is where it actually runs — the published page gets a database and connector
access that a local file does not, so opening this file directly in a browser
shows the world but no live data.

## The world

Four districts — Anwar Logistics, Anwar Capital, Anwar Autowerks, Anwar Creative
Studio. Anwar Ventures is a fifth board group with no building; its threads work
the centre plaza.

One worker per workstream:

- walking — in flight
- still, pulsing amber — blocked, or gone quiet past 7 days
- pulsing green — done, waiting on you
- absent — shipped or parked
- carrying a lit terminal — a Claude Code session; empty-handed is a chat

Click a worker to open its drawer, then through to the project.

Navigation: drag or WASD to pan, scroll to pan and pinch to zoom, right-drag or
Q/E to turn, F to reset.

## How the board stays current

Claude's cloud sandbox cannot read `~/.claude` — it is walled off — so the
reading happens locally and Claude reads the output.

1. `sync/nuqta_sync.py`, run by launchd every 15 minutes, walks
   `~/.claude/projects` and writes `~/NuqtaSync/sessions.json`.
2. `~/NuqtaSync` is connected to Claude as a folder.
3. A scheduled task at 8am PT reads it and writes the Claude Code projects into
   the artifact's `workstreams` collection.

Install (from this folder):

    bash sync/install.sh

That copies the script to `~/NuqtaSync/bin/`, runs it once, and schedules it.
`~/NuqtaSync` is the install location; this folder is the source. To stop it:

    bash sync/install.sh uninstall

## Rules that took several rewrites to land

- **Identity comes from the Claude Code directory name, never from `cwd`.**
  `cwd` is recorded per event and is often the parent folder a session was
  launched from, which silently collapses sibling projects into one row.
- **Git worktrees fold into their parent repo.** Otherwise every throwaway
  worktree becomes a project named something like `laughing-bassi-789f75`.
- **`~/NuqtaSync/ignore.txt`** holds one substring per line. Scrapped projects
  keep their session history on disk forever, so without this the sync brings
  them back.
- **The sync never changes a status set by hand, and never deletes a row.**
- **Failures are visible in the page, not swallowed.** A silent catch is what
  made the board look empty for a whole day.

## What cannot be automated

claude.ai project chats have no API, so those rows are added by asking Claude in
any conversation ("add a workstream for X under Anwar Capital"). Any
conversation can read and write the same board.

## Name

*Nuqta* is the dot — the brass nuqta at the centre of the Anwar mark is where
the name came from. The company is Nuqta Intelligence LLC.
