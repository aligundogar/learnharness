# Narrow viewports

How the browser build behaves below the desktop window floor, and the rules new UI follows.
This page covers the core shell and session chrome. It is a contract for the current
implementation, not a promise that every surface has been adapted yet (see *Not yet adapted*).

## The breakpoint

`narrow` is **width < 40rem (640px)** — the Electron window floor (`electron/main.cjs`,
`minWidth: 640`). Electron can never reach it, so this is a browser-only layout; every
width at or above 640px stays the unchanged desktop layout.

The Tailwind custom variant lives in `app/globals.css`:

```css
@custom-variant narrow (@media (width < 40rem));
@custom-variant coarse (@media (pointer: coarse));
```

Both are CSS-only: layout must not depend on a JS width listener. The single exception is
the sidebar, where JS chooses which DOM to mount; it reads the same query
(`NARROW_QUERY` in `components/sidebar.tsx`). `tests/narrow-layout.test.ts` pins the
three spellings together.

`coarse` is about the pointer, not the width: a narrow desktop window keeps its keyboard
hints and dense targets.

## Behavior below 640px

- **Sidebar** — an overlay drawer: fixed at the left edge, backdrop, Esc and backdrop
  dismissal, closes on any route change, starts closed, and never writes the desktop
  preference (`lh:sidebar-open`). Content takes the full width. At ≥640px the inline
  sidebar is unchanged, including the 928px auto-close (Electron) and `expandWindow`.
- **Top bar** — the session title uses the 20px rung instead of 32px, so a phone shows a
  readable prefix instead of two characters. Everything else in the bar is unchanged.
- **Docks** — keyboard-only hints (`↵ submits · ⇧↵ newline`) are hidden on coarse
  pointers. The dictation control keeps a 36px floor and drops its label, so it can no
  longer collapse to zero width in the under-composer row.
- **Platform** — `generateViewport` in `app/layout.tsx` sets `interactive-widget=resizes-content`
  (Android Chrome shrinks the layout viewport for the keyboard) and a `theme-color`
  matching the active theme. Safe-area tokens (`--lh-safe-*`) exist for edge-pinned
  surfaces; the app shell stays inside the browser's own insets because
  `viewport-fit=cover` is not adopted yet.

## Rules for new UI

1. Use the `narrow:` variant for layout, `coarse:` for input ergonomics. Do not add JS
   width listeners; extend the sidebar's single query only if the DOM itself must differ.
2. No fixed pixel width without a narrow cap (`narrow:max-w-full`, a stacked layout, or a
   sheet).
3. A keyboard-only affordance needs a visible touch path on the same surface.
4. Two-column surfaces (settings, side question) get a single-column narrow presentation,
   not a squeezed one.

## Not yet adapted

Settings, the side-question panel, the plan map and diagram overlays, and plugin UIs keep
their desktop geometry below 640px. The touch-target sweep (40px floor on coarse
pointers) and an installable web app manifest are also pending. Each is proposed as a
separate change in issue
[#732](https://github.com/amosblomqvist/learnharness/issues/732).

## Reaching the app from a phone

`npm run dev` and `npm start` listen on localhost only. Serve the browser build on the
LAN with `npm run dev -- -H 0.0.0.0` (or the production equivalent) and open
`http://<this machine's IP>:3000`. Browser mode has no login, so only do this on a
network you trust, and remember that dictation needs a secure context: plain
`http://<ip>` will not get microphone access. Use HTTPS (a reverse proxy or a tailnet)
when dictation matters.
