# Component kit: design guide

Every component in `ui/components/` follows this file. It is the approved outcome of genjutsu (paint), design-taste-frontend and Hallmark (app-screen scope), applied to a kit that renders inside BB's chat.

## Thesis (approved)

**Visual.** Part of the conversation, not a dashboard pasted into it. BB's own neutrals; BB's accent as the only signal colour, spent on the one thing each component is about (the current value, the selected option, the primary action); success, warning and danger only for real state. BB's Inter at its 13px scale, one heading weight (560), tabular numerals on every figure, sentence-case labels, mono only for code, paths, hashes and IDs. Dense but breathing on a 4px unit. Flat surfaces: whitespace, then a hairline, then a tinted well. Never a card inside the block's card. One radius per nesting level.

**Interaction.** Fast and dry: 120ms press and colour, 220ms hover and menus, 420ms at most for expanding. Hover is one signal (a colour step), press a 1px drop. Charts draw once, after the block stops streaming. No scroll reveals, no bounce or overshoot, no glow, no looping animation except the loading skeleton and a running Timer. Reduced motion shows the end state at once.

**Allowed patterns:** tabular numerals, mono for code/paths/hashes, hairline rules, an accent lightness ramp for multi-series data, the skeleton pulse, a live Timer tick.

Dials: variance 3, motion 3, density 7.

## Tokens (`kit.css`)

Use only these. No literal colour, font-family, radius or duration in component CSS or inline styles.

| Token | For |
| --- | --- |
| `--bbui-ink`, `--bbui-muted` | text, secondary text |
| `--bbui-surface`, `--bbui-well`, `--bbui-rule`, `--bbui-field` | block background, tinted well, hairline, input border |
| `--bbui-accent`, `--bbui-accent-soft` | data marks, current value, selection (soft = selected background) |
| `--bbui-action`, `--bbui-action-ink` | the one primary button per block |
| `--bbui-success`, `--bbui-warning`, `--bbui-danger`, `--bbui-attention` | real state only |
| `--bbui-ring` | focus ring |
| `--bbui-s1..s6` (4, 8, 12, 16, 24px) | spacing |
| `--bbui-r-control` (6px), `--bbui-r-well` (8px) | radii: controls; wells and containers |
| `--bbui-text`, `--bbui-small`, `--bbui-tiny`, `--bbui-head`, `--bbui-figure` | `font:` shorthands |
| `--bbui-mono`, `--bbui-font` | families |
| `--bbui-micro` 120ms, `--bbui-short` 220ms, `--bbui-long` 420ms; `--bbui-ease-out`, `--bbui-ease-in`, `--bbui-ease-in-out` | motion |

Multi-series colour: a lightness ramp of the accent, e.g. `color-mix(in oklch, var(--bbui-accent) 100%/78%/56%/38%, var(--bbui-surface))` in a fixed order; context/reference series in `--bbui-muted`. Text never wears the data colour; a series is named by a swatch beside its label.

## Kit (`kit.tsx`, `../data.tsx`)

- `Skeleton({lines|height})`, `EmptyState({title, hint})`, `ErrorState({title, detail})`.
- `LoadedView({loaded, parse, isEmpty, empty, skeleton, children})`: the four states of a file-backed region.
- `useThreadFile(path, {media})` (`../data.tsx`): reads a file of the reply's thread through the server (workspace-relative, `$BB_THREAD_STORAGE/...` or `/tmp/...`). Returns `{state: "loading" | "error" | "ready"}`; with `media` a data URL.
- `Button({variant: "primary", state})`: the 8-state control. Class `.bbui-btn` if you need the raw element.
- `useAsk()(text)`: sends `text` as the user's next message. Use for choices, approvals and follow-ups.
- `useStreaming()`: true while the reply streams. Draw charts and enable interactions only when false.
- `fmt(n, {decimals, compact, unit})`, `clamp`, `TONES` (`neutral|accent|good|warn|bad|info` to a token), `cx`.
- Base classes: `.bbui` (put on every component root), `.bbui-label`, `.bbui-head`, `.bbui-figure`, `.bbui-mono`, `.bbui-well`, `.bbui-rule`.

## Contract

A group is one file `ui/components/<group>.tsx` exporting one `ExtraGroup` (`types.ts`): `{ name, notes?, components, examples }`, and its stylesheet `ui/components/<group>.css` (class prefix `bbui-<group>-`). Do not import CSS from `.tsx` (Node cannot load it); the stylesheet is registered in `styles.css` by the integrator. Do not edit `kit.*`, `types.ts`, `index.ts`, `styles.css`, `../library.ts`, `../data.tsx`, `../../app.tsx` or `scripts/`; ask for a kit change in your report instead.

- `defineComponent({ name, description, props, component })` from `@openuidev/react-lang`, zod from `zod/v4`.
- **Prompt budget.** The agent reads the signature (name, props in order, description) only when it asks for the component, but keep it tight: description one sentence (under ~200 chars) saying what it is for and anything non-obvious about the arguments; props flat, required first, the most distinctive prop first (key order = positional order); use `z.enum` for fixed choices; no deep nesting (use a child component with `.ref` for repeated items, e.g. `BoardItem`).
- **Names** are unique across the library (OpenUI built-ins are taken: Card, Stack, Table, Tabs, Steps, Button, Image, Tag, Callout, Form, Input, Select, Slider, ... see `generated/openui.ts` PROMPT). Child item components follow `<Parent>Item`.
- **Example:** one complete program per component in `examples`, starting `root = Stack([...])`, using realistic, clearly sample data (dates in sequence, totals that add up, no fake-precise claims). It must parse.
- **Interactive inputs** that the program can read (`$binding`) follow OpenUI's built-in pattern: study `Slider` / `RadioGroup` in `node_modules/@openuidev/react-ui/dist/index.mjs` (`reactive(...)` schema and `useStateField`). Inputs inside a `Form` must also register in form state like the built-ins do (study `useSetFieldValue` / `useFormName` usage there), so the submitted answer reaches the message.
- **Props arrive possibly partial while streaming** (`useStreaming()` true): guard every array and number; never throw from render.

## Rules every component meets

1. `.bbui` on the root. Every colour, font, radius and duration from a token.
2. Controls: eight states (default, hover inside `@media (hover: hover)`, `:focus-visible` ring at once, active 1px drop, disabled = `opacity: 0.55` + `cursor: not-allowed` + native `disabled`, loading, error, success). 32px tall, 44px hit area. `type="button"` on every button. Labels and `aria-*` on every field.
3. Regions that load data: skeleton, empty (what is empty + how to fill it), error (what broke + what to do), data. Use `LoadedView`.
4. Charts: inline SVG written for the data, no chart library. Bars <= 24px, from zero, rounded 2px at the data end only; lines 2px; 3 to 5 hairline gridlines; one y-axis; no shadows, 3D or gradients (sparkline fade-fill excepted). Colour SVG through CSS classes or `style={{ fill: "var(--bbui-accent)" }}`, never a `fill="var(...)"` attribute. Axis and value text in `--bbui-muted` / `--bbui-ink`, `--bbui-tiny`.
5. Motion: `transform` and `opacity` only; never `transition: all`, never animate width/height/top/left (animate `transform: scaleX()` with `transform-origin` instead). Every animation has a `prefers-reduced-motion: reduce` override.
6. Copy: no em or en dashes anywhere (use a comma, colon, full stop or hyphen), no tracked capitals, eyebrows or small caps, no middle-dot-joined strings, no decorative status dots (a dot only for real state, with a text label), no emoji as icons, no "Oops", no exclamation marks. Icons: `lucide-react` (already a dependency of OpenUI; one family), 14 to 16px, `strokeWidth` 1.75.
7. Layout: fits the chat measure (about 640 to 760px) and down to 320px; `min-width: 0` on flex/grid children; long text wraps (`overflow-wrap: anywhere` for paths and hashes); tables full width, horizontal rules only, no outer border.
8. Accessibility: semantic elements (`button`, `ol`, `dl`, `table`, `figure` + `figcaption`), charts get `role="img"` and an `aria-label` that states what the chart shows, contrast AA.

## Checks before you report

```bash
npx tsx scripts/check-group.tsx ui/components/<group>.tsx   # examples parse, render (streaming and not), signatures fit
npx tsc --noEmit                                               # must be clean for your files
node ~/.claude/skills/hallmark/scripts/sloplint.mjs ui/components/<group>.tsx ui/components/<group>.css --scope app
```

Fix every failure. For sloplint, fix every FAIL; fix every REFLEX or waive it in a comment at the top of your CSS with a real reason.
