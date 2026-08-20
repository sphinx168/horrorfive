# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-player prototype of a browser-based horror narrative game called **五樓 (Fifth Floor)**. The player logs in as 陳思妤 (Chen Siyu) and browses a simulated "old internet" — a nostalgic web forum, a Yahoo Messenger chat archive, a Yahoo Mail inbox, and a personal blog — piecing together a decade-old story of workplace harassment and the one person who tried to stop it. There is no build system, no dependencies, and no test suite: the entire game is one self-contained HTML file.

- [五樓_單人版.html](五樓_單人版.html) — the whole game: markup, CSS, and vanilla JS in one file, no external resources.
- [恐怖留言板遊戲_idea.md](恐怖留言板遊戲_idea.md) — the design document (Traditional Chinese), **single-player only**. This is the source of narrative truth: character backstories, the intended emotional arc (contempt → doubt → grief → guilt), the linear-disclosure-chain puzzle design (§4), and an open "待決定" (undecided) checklist of the remaining 30-minute expansion questions. Read this before making any narrative or pacing change — code changes should stay consistent with it, and if a design question it flags as undecided gets resolved in code, reflect that back into the doc.
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

- `DOCS` — every readable document in the game (forum threads, the messenger archive, the mail inbox, the blog). Each entry has an `id`, a `skin` (which renderer draws it: `wulou`/`archive`/`inbox`/`blog`), and an `at` (the minimum `prog` value at which it becomes unlocked/visible). Locked docs still show in the sidebar via `peek` text as a teaser.
- `GATES` — the puzzle "logins" the player must solve to advance chapters (Yahoo Mail login, the board's admin restore form, a search box). Each gate defines `fields` with an `answer` list checked via fuzzy `match()`/`norm()` (handles full-width/half-width punctuation, spacing, case — a typo-tolerance holdover from the original co-op design where answers were transcribed by ear; kept here purely to forgive input mistakes).
- `AFTER` — what unlocks (`unlockAt`, i.e. the new `prog` value) once a given gate is solved.
- `SITE` — per-doc/per-gate metadata for the fake browser chrome: tab label, fake URL, favicon color.

**Progress state:** a single `let prog` (0–6) gates almost everything — which `DOCS` are visible, which `GATES` are active (`curGate()` maps `prog` ranges to a gate), and when the ending sequence fires. Advancing `prog` is the only "save" concept; there is no persistence across reloads.

**Rendering:** `render()` → `renderChrome()` (tabstrip/omnibox) + `renderPage()`, which dispatches on the active doc/gate's `skin` to one of `renderThread` (forum), `renderArchive` (messenger log), `renderInbox` (Yahoo Mail), `renderBlog`, `renderGate` (login/admin/search forms), or `renderEnd`. Each renderer does a full innerHTML re-render (no diffing) plus a `sidebar()` panel showing unlocked docs and chapter checklist. Every render call re-runs `syncTabs()` first to keep the open tab list consistent with current `prog`.

**When adding new story content:** add a `DOCS` entry (pick a `skin`, write `posts`/`days`/`mails`/`entries` in that skin's shape) and register it in `SITE`; if it should be gated behind a puzzle, add a `GATES` entry and an `AFTER` unlock mapping. Keep new copy in Traditional Chinese matching the existing character voices (see the design doc's per-character dialogue notes).
