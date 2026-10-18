<div align="center">
  <img src="docs/logo.svg" width="72" alt="Obrub">
  <h1>Obrub</h1>
  <p><strong>A curb planner for yards and driveways.</strong><br>
  Draw or import the parts of your yard, mark where the concrete curbs go, and get the exact number of pieces, where to cut them and what it costs.</p>
  <p>
    <a href="#getting-started">Getting started</a> ·
    <a href="#features">Features</a> ·
    <a href="#how-the-layout-works">How the layout works</a> ·
    <a href="#keyboard-shortcuts">Shortcuts</a>
  </p>
</div>

![Obrub showing a whole yard with one part of a join selected](docs/hero.png)

## Getting started

```sh
pnpm install
pnpm dev          # http://localhost:6123, also on your local network for a phone
```

The plan saves itself to [`data/plan.json`](data/plan.json). The file is committed, so the plan travels with the repository. The interface is in English or Croatian; switch it from the menu or in Settings.

## Features

<table>
<tr>
<td width="50%"><img src="docs/outline.png" alt="An imported outline with numbered edges"></td>
<td>

### Irregular shapes from Photoshop
Export a shape layer as SVG (*Export As → SVG* or *Copy SVG*) and drop it on the canvas, or just paste the code with <kbd>⌘V</kbd>. Every outline becomes a shape, split into edges at corners and where a straight run turns into an arc. Click an edge to add or remove its curb; edges without a curb are dashed.

Rectangles with rounded corners can also be typed in, in drawing pixels or in centimetres.

</td>
</tr>
<tr>
<td>

### Joins, knife and magnetic edges
Shapes stick to each other while you drag them. Join selected shapes (<kbd>Shift</kbd> + click) into one outline: curbs then run only along the outside, with no doubled pieces where the parts meet. The knife (<kbd>K</kbd>) cuts away the part of a shape you don't need.

</td>
<td width="50%"><img src="docs/measure.png" alt="Ruler and the gap between two parts"></td>
</tr>
<tr>
<td width="50%"><img src="docs/materials.png" alt="Material list for the whole yard"></td>
<td>

### Measuring and the material list
The ruler (<kbd>M</kbd>) snaps to corners, edges and the outer face of the curbs. Type the gap between two parts (<kbd>⌥</kbd> + click) in centimetres and the selected part moves to match. The material list adds everything up and gives you a shopping list with a reserve.

</td>
</tr>
<tr>
<td>

### A4 print
Page one shows the whole yard, the totals and a table per part. With *Detailed export*, every part gets its own page with a larger drawing, numbered edges and the order of pieces along each edge, for example `2×100 + cut 75.1 + 3×100 + 33`.

</td>
<td width="50%"><img src="docs/print.png" alt="The first page of the printout"></td>
</tr>
</table>

<details>
<summary>Detailed print page and the phone layout</summary>
<br>
<p align="center">
  <img src="docs/print-detail.png" width="48%" alt="A print page for one part">
  &nbsp;
  <img src="docs/mobile.png" width="28%" alt="Obrub on a phone">
</p>
</details>

## How the layout works

Curbs are 9×20×100 and 9×20×33 cm with a 1 cm joint. Prices, the joint and the drawing scale (e.g. 214 px = 650 cm) are in Settings.

- **A straight edge between two corners:** the fewest pieces with at most one cut, and the cut piece goes in the middle.
- **An edge with a free end:** whole pieces from the fixed end, and whatever is left becomes one cut piece at the free end.
- **Arcs:** 33 cm pieces, and 100 cm pieces only where they stay within 1 cm of the true curve. A rounded corner's radius is adjusted so that whole pieces fit. Each arc shows its deviation and the outer joint width.
- **Corners other than 90°:** a mitre cut on both pieces, with the angle in the table.
- **Three modes:** 100 + 33 cm, 100 cm only, or 100 cm pieces cut in half for arcs.

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| <kbd>V</kbd> | Select | <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo |
| <kbd>H</kbd> or space | Pan | <kbd>⌘D</kbd> | Duplicate |
| <kbd>M</kbd> | Ruler | <kbd>R</kbd> / <kbd>⇧R</kbd> | Rotate 90° |
| <kbd>K</kbd> | Knife | Arrows | Nudge 1 cm (10 cm with <kbd>⇧</kbd>) |
| <kbd>N</kbd> | New shape | <kbd>⇧1</kbd> / <kbd>⇧2</kbd> | Zoom to all / selection |
| <kbd>⌘P</kbd> | Print | <kbd>?</kbd> | All shortcuts |

## Development

React, TypeScript, Vite and an SVG canvas, with no backend: a small middleware in [`vite.config.ts`](vite.config.ts) stores the plan. Every save carries a revision number, so two open windows (say a laptop and a phone) never overwrite each other.

```sh
pnpm typecheck
pnpm e2e          # starts its own server on :6124 with a test plan; your plan is untouched
```

| Path | What it holds |
|---|---|
| `src/geometry.ts` | Piece layout along edges, arcs, mitre cuts |
| `src/svgImport.ts` | Reading SVG outlines and splitting them into edges |
| `src/join.ts`, `src/cut.ts` | Joining parts and the knife |
| `src/i18n.ts` | English and Croatian text |
| `src/components/` | Canvas, panels, print view |
| `e2e/smoke.mjs` | Browser test covering all of the above |
