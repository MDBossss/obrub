import { cleanOutline, cmPerPx, layout, outlineToShape, shapeBounds } from './geometry'
import { t } from './i18n'
import { newId, useStore } from './store'
import { parseSvg } from './svgImport'
import type { Shape } from './types'

// Adds every closed outline in the SVG as a shape, keeping their positions relative to each other
export async function importSvgFile(file: File): Promise<string> {
  return importSvgText(await file.text(), file.name.replace(/\.svg$/i, '')).message
}

// `base` names layers that have no name of their own; without it they become "Shape 1", "Shape 2", …
export function importSvgText(text: string, base?: string): { ok: boolean; message: string } {
  const st = useStore.getState(), k = cmPerPx(st.settings)
  let outlines
  try { outlines = parseSvg(text.trim()) } catch (e) { return { ok: false, message: (e as Error).message } }
  if (!outlines.length) return { ok: false, message: t('U SVG-u nema zatvorenih obrisa. U Photoshopu izvezi shape sloj ili put (Export As → SVG).') }
  // place the import to the right of what is already on the plan
  let right = 0, top = 0
  if (st.shapes.length) {
    right = -Infinity; top = Infinity
    for (const s of st.shapes) { const b = shapeBounds(s, layout(s, st.settings)); right = Math.max(right, b.x1); top = Math.min(top, b.y0) }
    right += 300
  }
  const minX = Math.min(...outlines.flatMap((o) => o.pts.map((p) => p[0]))), minY = Math.min(...outlines.flatMap((o) => o.pts.map((p) => p[1])))
  const added: Shape[] = outlines.map((raw, i) => {
    const o = { ...raw, ...cleanOutline(raw.pts, raw.breaks) }
    const f = outlineToShape(o.pts), name = (o.name || (base ? `${base} ${i + 1}` : t('Oblik {n}', { n: i + 1 }))).replace(/_/g, ' ')
    return {
      id: newId() + i, name, kind: /trav|zelen|grass/i.test(name) ? 'trava' : 'asfalt',
      wpx: f.wpx, hpx: f.hpx, r: { tl: 0, tr: 0, br: 0, bl: 0 }, sides: { t: true, r: true, b: true, l: true }, mode: 'mix',
      x: Math.round(right + (f.x0 - minX) * k), y: Math.round(top + (f.y0 - minY) * k), rot: 0,
      path: { pts: f.pts, breaks: o.breaks },
      edgeCurbs: o.breaks.map(() => true),
    }
  })
  useStore.setState({ shapes: [...st.shapes, ...added], selected: added.length === 1 ? added[0].id : null })
  return { ok: true, message: t('Uvezeno oblika: {n}. Klikni rub na platnu da uključiš ili isključiš rubnjak.', { n: added.length }) }
}

export function toggleEdge(sh: Shape, idx: number) {
  const st = useStore.getState()
  if (sh.path) {
    const curbs = sh.path.breaks.map((_, i) => sh.edgeCurbs?.[i] ?? true)
    curbs[idx] = !curbs[idx]
    st.updateShape(sh.id, { edgeCurbs: curbs })
  } else {
    const key = (['t', 'r', 'b', 'l'] as const)[idx]
    st.updateShape(sh.id, { sides: { ...sh.sides, [key]: !sh.sides[key] } })
  }
}
