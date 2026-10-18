# Styles organization

Use the smallest stylesheet that owns a rule:

- `base.css`: tokens, reset, typography defaults, and true browser-wide rules.
- `layout.css`: the app shell and reusable page framing (`.page`, headings,
  `.muted`, and similar layout primitives).
- `components/`: styles tied to one reusable component. The component imports
  its stylesheet directly.
- `pages/`: styles used only by one route. The route imports its stylesheet.
- `styles.css`: now only an ordered list of `@import`s for `legacy/`.
- `legacy/NN-*.css`: the old 29.5k-line `styles.css`, split (2026-10-18) into
  23 partials of about 1,200 lines, cut at section comments with no content
  changes (built CSS was byte-identical before and after). File names say what
  each part mostly styles (`kojocode` = LeetCode mode `lc-*`, `learning-modules`
  = `lm-*`, `system-design` = `sd-*`). Order is the cascade: never reorder the
  imports. To find a selector, search `legacy/`. Do not add new component- or
  page-specific rules here.

## Migration rule

Move one visually related block at a time, preserve its source order where it
can override shared rules, then run `npm run build`. Avoid moving a selector
just because its name starts with a page prefix: some existing rules are shared
between routes and belong in `components/` or `layout.css` instead.
