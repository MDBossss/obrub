// Knife: a line drawn right across shapes splits each one into separate outline shapes
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { cleanOutline, cmPerPx, layout, outlineToShape, toWorld, type Pt } from './geometry'
import { ringBreaks } from './join'
import { newId, useStore } from './store'
import type { Shape } from './types'

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

function inside(ring: Pt[], p: Pt) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function crossings(ring: Pt[], a: Pt, b: Pt) {
  let n = 0
  const cr = (o: Pt, p: Pt, q: Pt) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i], d = ring[(i + 1) % ring.length]
    if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) n++
  }
  return n
}

function distToPolyline(p: Pt, line: Pt[]) {
  let m = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0
    m = Math.min(m, d2(p, [a[0] + dx * t, a[1] + dy * t]))
  }
  return m
}

function midOf(line: Pt[]): Pt {
  let total = 0
  for (let i = 0; i + 1 < line.length; i++) total += d2(line[i], line[i + 1])
  let acc = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const s = d2(line[i], line[i + 1])
    if (acc + s >= total / 2) { const t = s ? (total / 2 - acc) / s : 0; return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t] }
    acc += s
  }
  return line[0]
}

const area = (r: Pt[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2

export function cutShapes(a: Pt, b: Pt): string {
  const st = useStore.getState(), k = cmPerPx(st.settings), L = d2(a, b)
  if (L < 1) return ''
  const dir: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], N: Pt = [-dir[1], dir[0]], BIG = 1e6
  // the blade is the half-plane on one side of the drawn segment, limited to the segment's length
  const blade: Polygon = [[a, b, [b[0] + N[0] * BIG, b[1] + N[1] * BIG], [a[0] + N[0] * BIG, a[1] + N[1] * BIG], a].map(([x, y]) => [x, y] as [number, number])]
  let shapes = [...st.shapes], joins = [...st.joins]
  const made: { id: string; area: number }[] = [], partial: string[] = []
  let cut = 0
  for (const sh of st.shapes) {
    const lay = layout(sh, st.settings), w = toWorld(sh, lay), ring = lay.outlinePts.map(w)
    if (crossings(ring, a, b) < 2) continue
    if (inside(ring, a) || inside(ring, b)) { partial.push(sh.name); continue }
    const poly: Polygon = [[...ring, ring[0]].map(([x, y]) => [x, y] as [number, number])]
    const parts = [...polygonClipping.intersection(poly, blade), ...polygonClipping.difference(poly, blade)]
    if (parts.length < 2) continue
    const oldEdges = lay.edges.map((e) => ({ pts: e.pts.map(w), curbed: e.curbed }))
    const corners = lay.vertices.map(w), samples = oldEdges.flatMap((e) => e.pts).concat(ring)
    const pieces: Shape[] = parts.map((part, i) => {
      const outer = part[0].slice(0, -1) as Pt[]
      const clean = cleanOutline(outer, ringBreaks(outer, corners, samples))
      const n = clean.pts.length, E = clean.breaks.length
      // an edge along the old outline keeps its curb setting; the new cut edge gets a curb
      const edgeCurbs = clean.breaks.map((s, e) => {
        const end = e + 1 < E ? clean.breaks[e + 1] : clean.breaks[0] + n, line: Pt[] = []
        for (let q = s; q <= end; q++) line.push(clean.pts[q % n])
        const m = midOf(line)
        let best = { d: Infinity, curbed: true }
        for (const oe of oldEdges) { const d = distToPolyline(m, oe.pts); if (d < best.d) best = { d, curbed: oe.curbed } }
        return best.d < 1 ? best.curbed : true
      })
      const f = outlineToShape(clean.pts.map(([x, y]) => [x / k, y / k] as Pt))
      const id = newId() + i
      made.push({ id, area: area(clean.pts) })
      return {
        id, name: `${sh.name} ${i + 1}`, kind: sh.kind, mode: sh.mode, rot: 0,
        wpx: f.wpx, hpx: f.hpx, x: +(f.x0 * k).toFixed(2), y: +(f.y0 * k).toFixed(2),
        r: { tl: 0, tr: 0, br: 0, bl: 0 }, sides: { t: true, r: true, b: true, l: true },
        path: { pts: f.pts, breaks: clean.breaks }, edgeCurbs,
      }
    })
    const at = shapes.findIndex((s) => s.id === sh.id)
    shapes = [...shapes.slice(0, at), ...pieces, ...shapes.slice(at + 1)]
    joins = joins.map((j) => (j.members.includes(sh.id) ? { ...j, members: [...j.members.filter((m) => m !== sh.id), ...pieces.map((p) => p.id)] } : j))
    cut++
  }
  if (!cut) return partial.length ? `Rez mora prijeći preko cijelog oblika (${partial.join(', ')}). Počni i završi izvan njega.` : ''
  // the smallest piece is most likely the excess: select it so Delete removes it
  const smallest = made.sort((x, y) => x.area - y.area)[0].id
  useStore.setState({ shapes, joins, selected: smallest, selection: [smallest] })
  return `Prerezano oblika: ${cut}. Odabran je najmanji dio; obriši ga s Delete ako je višak.`
}
