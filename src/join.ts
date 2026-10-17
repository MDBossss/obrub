// A join merges touching shapes into one outer outline; curbs run only along that outline
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { cleanOutline, layout, layoutRing, toWorld, type Layout, type Pt } from './geometry'
import type { Join, Settings, Shape } from './types'

export type JoinLayout = Layout & { error?: string }

const near = (pts: Pt[], p: Pt, tol: number) => pts.some((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol)

export function joinLayout(join: Join, shapes: Shape[], st: Settings): JoinLayout | null {
  const members = join.members.map((id) => shapes.find((s) => s.id === id)).filter((s): s is Shape => !!s)
  if (members.length < 2) return null
  const polys: Polygon[] = [], corners: Pt[] = [], samples: Pt[] = []
  for (const sh of members) {
    const lay = layout(sh, st), w = toWorld(sh, lay)
    const ring = lay.outlinePts.map(w)
    polys.push([[...ring, ring[0]].map(([x, y]) => [x, y] as [number, number])])
    corners.push(...lay.vertices.map(w))
    samples.push(...ring)
  }
  const union = polygonClipping.union(polys[0], ...polys.slice(1))
  const empty = { W: 0, H: 0, outline: '', outlinePts: [], vertices: [], edges: [], corners: [], pieces: [], runs: [], warns: [],
    nL: 0, nS: 0, buyL: 0, buyS: 0, half: false, cutCount: 0, halving: 0, length: 0, weight: 0, cost: 0 }
  if (union.length !== 1) return { ...empty, error: 'Oblici u spoju se ne dodiruju. Primakni ih (lijepe se kad su blizu) ili razdvoji spoj.' }
  const outer = union[0][0].slice(0, -1) as Pt[]
  const breaks = ringBreaks(outer, corners, samples)
  const clean = cleanOutline(outer, breaks)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of clean.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const lay: JoinLayout = layoutRing(clean.pts, clean.breaks, join.edgeCurbs ?? [], join.mode, st, x1 - x0, y1 - y0)
  if (union[0].length > 1) lay.warns.push('Spoj ima rupu u sredini; oko nje rubnjaci nisu računati.')
  return lay
}

export const joinOf = (joins: Join[], shapeId: string) => joins.find((j) => j.members.includes(shapeId))

// Edges of a computed ring start at the source shapes' corners, where outlines crossed, or at a sharp turn
export function ringBreaks(ring: Pt[], corners: Pt[], samples: Pt[]): number[] {
  const n = ring.length, breaks: number[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n]
    const u: Pt = [b[0] - a[0], b[1] - a[1]], v: Pt = [c[0] - b[0], c[1] - b[1]]
    const turn = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1))))
    if (near(corners, b, 0.5) || !near(samples, b, 0.5) || turn > (12 * Math.PI) / 180) breaks.push(i)
  }
  return breaks.length ? breaks : [0]
}
