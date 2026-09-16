# Regression checklist

Nuqta only fully runs inside Claude (the `sample`/`db`/`mcp` capabilities
don't exist anywhere else — see the README). There's no automated
browser-test runner for that surface, so this is the manual pass to run
after any change, before publishing. `node test.js` covers the pure logic
in `logic.js` separately and should also pass first.

Run this on the actual published artifact, not the GitHub Pages copy —
the Pages copy can only ever show steps 1 and 3a, by design.

## 1. Cold load, no data yet
- [ ] Open the artifact fresh. Loading screen shows, bar fills, world fades in.
- [ ] No console errors (`read_console_messages`, `onlyErrors: true`).
- [ ] Workstreams panel populates with real data within a few seconds.
- [ ] Inbox count and HubSpot deal count both resolve (not stuck on "…").

## 2. Board interaction
- [ ] Click a workstream row → drawer opens with correct detail, status, "why it's here" text.
- [ ] Change status via the drawer's dropdown → row updates immediately, and
      persists after a reload.
- [ ] "Touched today" button clears a "gone quiet" warning.
- [ ] Click a worker figure in the 3D world → same drawer opens.
- [ ] Toggle a milestone done/not-done → persists after reload.
- [ ] Exec view (top-right button) shows one card per district with correct
      counts; clicking a card pans the camera there.
- [ ] Filters (Chats / Needs you / Everything) actually change what's shown.

## 3. Agent chat, per company (AL, AC, AAW, ACS — all four, not just one)
- [ ] "✎ Talk" button appears next to every real company's group header,
      not Anwar Ventures (which has no 3D district to open a panel for).
- [ ] Opening it shows that company's name and its own accent color
      (glow, message bubbles, input focus) — not always violet.
- [ ] First message triggers the platform's one-time connector-consent
      dialog ("This artifact uses connectors — Use Claude").
- [ ] A plain question gets a grounded answer referencing real workstream
      names from that company, not generic filler.
- [ ] An action request ("mark X as touched", "set X to review") gets a
      "Done" reply.
- [ ] **Verify the action was real**, don't trust the reply text alone —
      query the `workstreams` collection directly
      (`ArtifactData` → `get`/`query`) and confirm the field actually
      changed and `version` incremented.
- [ ] Reload the page, reopen the same company's chat → prior transcript
      is still there.
- [ ] Asking about a different company's workstream should not be
      answerable — the tool's `execute()` scopes to `w.co === distId` and
      should throw "No workstream with that id for this company."

### 3a. Outside Claude (GitHub Pages / any plain static host)
- [ ] World renders, board shows "No chats on the board yet" / "Live deal
      feed unavailable here" — never a crash, never a blank page.
- [ ] Agent panel opens but shows "Agent unavailable here" and a disabled
      Send button — never a silently-eaten message.

## 4. Failure states (harder to trigger, worth knowing what they look like)
- [ ] HubSpot/Outlook connector declined or reauth-needed → the specific
      notice from `FEED_COPY` shows, not a generic error.
- [ ] Sending a message while `sample` rejects `not_granted` → error bubble,
      not a stuck spinner.

## 5. After a structural change specifically (module split, file rename, etc.)
- [ ] `node test.js` passes (24/24 as of the last split).
- [ ] Test locally via a real HTTP server, not `file://` directly if the
      Browser pane renders it outside the project directory — `file://`
      static-snapshot rendering breaks relative `<script src>` resolution
      in ways that don't reflect how it'll actually be served.
      `python3 -m http.server <port>` from the project directory, then hit
      `http://localhost:<port>/nuqta.html`.
