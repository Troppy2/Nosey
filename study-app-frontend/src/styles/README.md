# Styles organization

Use the smallest stylesheet that owns a rule:

- `base.css`: tokens, reset, typography defaults, and true browser-wide rules.
- `layout.css`: the app shell and reusable page framing (`.page`, headings,
  `.muted`, and similar layout primitives).
- `components/`: styles tied to one reusable component. The component imports
  its stylesheet directly.
- `pages/`: styles used only by one route. The route imports its stylesheet.
- `styles.css`: legacy rules that have not yet been moved. Do not add new
  component- or page-specific rules here.

## Migration rule

Move one visually related block at a time, preserve its source order where it
can override shared rules, then run `npm run build`. Avoid moving a selector
just because its name starts with a page prefix: some existing rules are shared
between routes and belong in `components/` or `layout.css` instead.
