# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-player prototype of a browser-based horror narrative game called **五樓 (Fifth Floor)**. The player logs in as 陳思妤 (Chen Siyu) and browses a simulated "old internet" — a nostalgic web forum, a Yahoo Messenger chat archive, a Yahoo Mail inbox, and a personal blog — piecing together a decade-old story of workplace harassment and the one person who tried to stop it. There is no build system, no dependencies, and no test suite: the entire game is one self-contained HTML file.

- [五樓_單人版.html](五樓_單人版.html) — the whole game: markup, CSS, and vanilla JS in one file, no external resources.
- [恐怖留言板遊戲_idea.md](恐怖留言板遊戲_idea.md) — the design document (Traditional Chinese), **single-player only**. This is the source of narrative truth: character backstories, the intended emotional arc (contempt → doubt → grief → guilt), the linear-disclosure-chain puzzle design (§四), the flow-to-`prog`/`GATES` mapping (§六), the decisions already locked into code (§七 設計定案), and the remaining open items (§八 待決定 — currently only the second pass over 序章／第一章 text). Read this before making any narrative or pacing change — code changes should stay consistent with it, and if a design question it flags as undecided gets resolved in code, tick it off and reflect the decision back into the doc.
- [index.html](index.html) — a meta-refresh redirect shim to `五樓_單人版.html` (for hosts that serve `index.html` by default, e.g. GitHub Pages). Not game logic; update its URL-encoded href if the main file is ever renamed.
- [archive/恐怖留言板遊戲_idea_多人協力版原始設計.md](archive/恐怖留言板遊戲_idea_多人協力版原始設計.md) — **archived, not maintained.** The original 4-player co-op design (shared-nothing screens, voice coordination, password/cross-reference/relay gates, the four-anomaly-puzzle mechanic). The project's target is now the single-player build; this file is kept only in case a multiplayer version is revisited later. Do not treat it as current design guidance.

## Running it

No server, no build. Just open the file directly:

```bash
start "" "五樓_單人版.html"
```

(or double-click it / open via `file://` in a browser). Login is pre-filled (`siyu_1120` / `1120`) since it's single-player and the "account" is fixed to one character.

## Architecture (五樓_單人版.html)

The file simulates a **tabbed browser inside the page** — a fake browser chrome (`#browser`, tabstrip, omnibox) rendered around an inner `#viewport` that swaps between different "site" skins. Everything is driven by one global progress counter and a handful of data tables at the top of the `<script>` block; there is no framework, no router, no external state.

**Core data model, all declared as plain JS arrays/objects near the top of the script:**

- `ME` / `USERS` / `who()` — the player's identity and the account→given-name map for the six colleagues. The board speaks in account ids but the characters call each other by name, so both are rendered together and the player never has to keep a mental lookup table.
- `DOCS` — every readable document in the game (forum threads, the messenger archive, the mail inbox, the blog). Each entry has an `id`, a `skin` (which renderer draws it: `wulou`/`archive`/`inbox`/`blog`), a `site` label, and an `at` (the minimum `prog` value at which it unlocks). Forum entries also carry `idx` (the board-homepage row: floor count, last replier, display time, and a `ts` sort key from `TS()`/`TS_NOW()`) and optionally `peek`/`lockTitle` (locked-state teaser text — only consumed by the currently disabled 我的最愛 tab, see below). Individual `posts` inside a thread can carry their own `at` (drip-fed replies) or an `rid` (a deleted floor and its restored counterpart — see `restored`).
- `BOARD_DECO` + `boardRows()` — the board homepage (`board_index`) is generated, not authored: unlocked `wulou` docs are merged with a handful of un-clickable decorative threads and sorted by `ts`, so the board looks like it has been alive for eleven years and new threads surface at the top.
- `GATES` — the four puzzle steps that advance the chapters, in order: `g_mail` (Yahoo Mail login), `g_ytl` (the board's admin login, as 林昱庭), `g_admin` (restoring the deleted floor), `g_search` (searching his name). Each gate has a `skin` (`yahoo`/`admin`/`restore`/`search`) that picks its renderer, plus `ch`/`label`/`need` copy for the checklist. Most define `fields` with an `answer` list checked via fuzzy `match()`/`norm()` (handles full-width/half-width punctuation, spacing, case — a typo-tolerance holdover from the original co-op design, kept here purely to forgive input mistakes), optional `forgot` hint and `nudge` per-wrong-answer messages. `g_admin` is the exception: no fields, it's a click-to-restore list driven by `restorables()`.
- `AFTER` — what happens once a gate is solved: `unlockAt` (the new `prog` value) and `said` (a full-screen narration beat played before the next page, via `saidNow`/`renderSaid`).
- `SITE` — per-doc/per-gate metadata for the fake browser chrome: tab label, fake URL, favicon color.

**Progress state:** a single `let prog` gates almost everything — which `DOCS` and posts are visible, which gate is active (`curGate()` maps `prog` ranges to a gate), and when the ending fires. It advances only at fixed points: gates set `prog = AFTER[id].unlockAt` (→1, 2, 3), clicking the search result sets `prog = 5` and opens the blog, and posting the reply in `t_today` sets `prog = 6` → `renderEnd`. (4 is currently never assigned; `curGate()` still accepts it.) Other mutable state: `boardTab`, `seen` (which docs have been opened — drives the "new" marker), `restored` (floors recovered in the admin backend), `mailFolder`/`mailOpen`, `gateDone`, `MAX_DOC_TABS` (3; opening a fourth document tab closes the oldest), and `NOTES_TAB_ENABLED` (false — the 我的最愛 tab with its collected-docs list and chapter checklist is hidden because it broke the immersion; `notesContent()`/`renderNotes()` are kept behind the flag). There is no persistence: reloading restarts the game.

**Rendering:** `render()` → `syncTabs()` (keeps the open tab list consistent with the current `prog`) → `renderChrome()` (tabstrip/omnibox) + `renderPage()`, which shows a pending `saidNow` beat first, then dispatches on the active doc's `skin` or the active gate to `renderBoardIndex`, `renderThread`, `renderArchive`, `renderInbox`, `renderBlog`, `renderGate`, `renderRestore`, `renderNotes`, or `renderEnd`. Each renderer does a full `innerHTML` re-render (no diffing) and re-binds its own handlers.

**When adding new story content:** add a `DOCS` entry (pick a `skin`, write `posts`/`days`/`mails`/`entries` in that skin's shape), give forum threads an `idx` so they appear on the board homepage, and register it in `SITE`; if it should be gated behind a puzzle, add a `GATES` entry and an `AFTER` unlock mapping. Keep new copy in Traditional Chinese matching the existing character voices (see the design doc's per-character dialogue notes).
