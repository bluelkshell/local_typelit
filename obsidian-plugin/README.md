# Local TypeLit for Obsidian

Practise typing on your own notes, inside Obsidian. This is the Obsidian version of the Local TypeLit
Django app in the parent folder. It is a **separate implementation** (TypeScript, running inside
Obsidian), not a client for that app: the two do not share books, progress or stats.

## What it does

- **Type the current note**: opens a typing tab with the note's text. Markdown is stripped, so you type
  the prose, not the `#`, `**` and `[[ ]]`.
- **Type the selected text**: practise just a passage.
- Right-click a note in the file list and choose **Type this note**.
- Live WPM, accuracy and time, a gliding caret, and a progress bar.
- **Your place is remembered**: close the tab or quit Obsidian and pick up where you stopped.
- The clock **pauses after a few seconds without typing**, and when you leave the window.
- **Show typing stats** lists your averages, best WPM and recent runs.

How typing works: a wrong key still advances (and turns red), Backspace fixes it, and a run finishes when
you reach the end with no mistakes left. WPM is net: correct characters / 5 per minute. `Esc` starts over.

## Install

Requires Node.js 22 or newer.

```sh
cd obsidian-plugin
npm install
npm run build
npm run install-to-vault -- /path/to/your/vault
```

Then in Obsidian: **Settings > Community plugins**, turn on **Local TypeLit** (reload plugins if it isn't
listed). Re-run the last two commands after changing the code. To work on it, run `npm run dev` (rebuilds on
every save) and use a vault you don't mind experimenting in.

You can also copy `main.js`, `manifest.json` and `styles.css` yourself into
`<vault>/.obsidian/plugins/local-typelit/`.

## Settings

Text size, the idle-pause delay, live stats, whether to strip Markdown, skip code blocks, use plain
punctuation (curly quotes and long dashes become keys on your keyboard) and a maximum length (long notes
are cut at a word boundary). A button clears your history and saved places. Your notes are never modified.

## Where your data is

Settings, saved places and the last 500 runs are in
`<vault>/.obsidian/plugins/local-typelit/data.json`. If you use Obsidian Sync or a synced vault, that file
goes with it.

## Develop

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the typing engine, Markdown cleanup and data handling (no Obsidian needed) |
| `npm run typecheck` | Type-check against Obsidian's API definitions |
| `npm run build` | Type-check and produce `main.js` |
| `npm run dev` | Rebuild on every change |

```
src/engine.ts    typing rules, clock, WPM and accuracy (pure, tested)
src/text.ts      Markdown to typeable text (pure, tested)
src/storage.ts   settings, progress and history; validates data.json (pure, tested)
src/view.ts      the typing tab
src/main.ts      commands, menu, ribbon icon, saving
src/settings.ts  settings tab
src/stats.ts     stats window
```

## Not included yet (the Django app has these)

PDF/EPUB import, the Pomodoro timer, the finger guide, focus mode and a stats page with history over time.
They can be added; the typing engine is shared by none of them yet.

## Honest status

The logic is unit-tested, the plugin type-checks against Obsidian's real API definitions, and the built
`main.js` was exercised in a headless browser against a stand-in for Obsidian's API (66 scripted checks:
typing, mistakes, idle pause, autosave, resume, finishing, stats, restart, selections, restoring tabs,
settings and damaged data). It has **not been run inside real Obsidian**, on mobile, or with many themes,
so expect to find rough edges. Please report what you see.
