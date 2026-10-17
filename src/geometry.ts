import type { Mode, Settings, Shape } from './types'

export const L = 100
export const B = 9
export const HALF = 49.8 // a hand-cut half loses ~3 mm to the blade

export type PieceType = 'L' | 'S' | 'C'
export type Pt = [number, number]
export interface Piece { t: PieceType; len: number; pts: Pt[] }
export interface Run { label: string; len: number; seq: number[]; S: number; note: string }
export interface Corner { R0: number; R: number; n: number; curbed: boolean; square: boolean }
export interface Edge { d: string; curbed: boolean; toggle: number | null; mid: Pt; pts: Pt[]; label: string } // toggle: side index (rect) or edge index (outline)
export interface Layout {
  W: number; H: number; outline: string; outlinePts: Pt[]; vertices: Pt[]; edges: Edge[]; corners: Corner[]; pieces: Piece[]; runs: Run[]; warns: string[]
  nL: number; nS: number; buyL: number; buyS: number; half: boolean
  cutCount: number; halving: number; length: number; weight: number; cost: number
}

const SIDE_NAMES = ['Gore', 'Desno', 'Dolje', 'Lijevo']
const CORNER_NAMES = ['Kut gore desno', 'Kut dolje desno', 'Kut dolje lijevo', 'Kut gore lijevo']

export const f1 = (x: number) => x.toFixed(1).replace('.', ',')
export const f2 = (x: number) => x.toFixed(2).replace('.', ',')
export const cmPerPx = (s: Settings) => s.scm / s.spx

// Radius that fits n pieces and n+1 joints exactly into a quarter circle (inner face)
function arcRadius(n: number, g: number, len: number) {
  let lo = len / 2 + 1, hi = 5000
  for (let i = 0; i < 80; i++) {
    const r = (lo + hi) / 2, a = n * 2 * Math.asin(len / 2 / r) + (n + 1) * g / r
    if (a > Math.PI / 2) lo = r; else hi = r
  }
  return (lo + hi) / 2
}

// Run fixed at both ends: fewest pieces, at most one cut piece, placed in the middle
type RunPick = { a: number; s: number; cut: number; score: number }

function fixedRun(len: number, g: number, S: number, allowS: boolean) {
  let found: RunPick | null = null
  for (const minCut of [15, 3]) {
    for (let a = 0; a * (L + g) <= len + g; a++) for (let s = 0; s <= (allowS ? 4 : 0); s++) {
      const used = a * L + s * S + Math.max(a + s - 1, 0) * g, rest = len - used
      if (rest < -0.01) continue
      let cut = 0, waste: number
      if (rest <= 0.5 * Math.max(a + s - 1, 1)) waste = 0
      else {
        cut = rest - (a + s > 0 ? g : 0)
        if (cut < minCut || cut > L) continue
        waste = allowS && cut <= S ? S - cut : L - cut
      }
      // fewest pieces first, at most one cut; waste and symmetry only break ties
      const score = (cut ? 10 : 0) + (a + s) * 2 + waste * 0.05 + (a % 2 || s % 2 ? 1 : 0)
      if (!found || score < found.score) found = { a, s, cut, score }
    }
    if (found) break
  }
  const best = found as RunPick | null
  if (!best) return { seq: [] as number[], rest: len }
  const seq: number[] = [], hs = best.s / 2
  for (let i = 0; i < Math.floor(hs); i++) seq.push(S)
  for (let i = 0; i < Math.floor(best.a / 2); i++) seq.push(L)
  if (best.cut) seq.push(best.cut)
  for (let i = 0; i < Math.ceil(best.a / 2); i++) seq.push(L)
  for (let i = 0; i < Math.ceil(hs); i++) seq.push(S)
  return { seq, rest: 0 }
}

// Run with one free end: longs from the fixed end, then whatever is left as one piece at the free end
// (a whole 33 if it fits exactly, otherwise a single cut piece)
function freeRun(len: number, g: number, S: number, allowS: boolean) {
  const a = Math.max(0, Math.floor((len + g) / (L + g)))
  let rest = len - (a * L + Math.max(a - 1, 0) * g)
  const seq: number[] = Array(a).fill(L)
  const j = seq.length ? g : 0
  if (allowS && Math.abs(rest - j - S) <= 0.5) { seq.push(S); rest = 0 }
  else if (rest >= 15 + j) { seq.push(rest - j); rest = 0 }
  return { seq, rest }
}

export function layout(sh: Shape, st: Settings): Layout {
  if (sh.path) return layoutOutline(sh, st)
  const k = cmPerPx(st), g = st.gap, W = sh.wpx * k, H = sh.hpx * k
  const half = sh.mode === 'half', allowS = sh.mode !== 'long', S = half ? HALF : 33, arcLen = allowS ? S : L
  const sides = [sh.sides.t, sh.sides.r, sh.sides.b, sh.sides.l]
  const warns: string[] = []
  const corners: Corner[] = [sh.r.tr, sh.r.br, sh.r.bl, sh.r.tl].map((rp, i) => {
    const R0 = Math.max(0, rp * k), both = sides[i] && sides[(i + 1) % 4]
    const c: Corner = { R0, R: R0, n: 0, curbed: R0 > 0 && both, square: R0 === 0 && both }
    if (c.curbed) {
      let best = { n: 1, r: arcRadius(1, g, arcLen) }
      for (let n = 2; n < 120; n++) {
        const r = arcRadius(n, g, arcLen)
        if (Math.abs(r - R0) < Math.abs(best.r - R0)) best = { n, r }
      }
      c.n = best.n; c.R = best.r
    }
    return c
  })
  const [cTR, cBR, cBL, cTL] = corners
  const defs: { o: Pt; d: Pt; nrm: Pt; len: number }[] = [
    { o: [cTL.R, 0], d: [1, 0], nrm: [0, -1], len: W - cTL.R - cTR.R },
    { o: [W, cTR.R], d: [0, 1], nrm: [1, 0], len: H - cTR.R - cBR.R },
    { o: [W - cBR.R, H], d: [-1, 0], nrm: [0, 1], len: W - cBR.R - cBL.R },
    { o: [0, H - cBL.R], d: [0, -1], nrm: [-1, 0], len: H - cBL.R - cTL.R },
  ]
  const centers: [number, number, number][] = [
    [W - cTR.R, cTR.R, -Math.PI / 2], [W - cBR.R, H - cBR.R, 0], [cBL.R, H - cBL.R, Math.PI / 2], [cTL.R, cTL.R, Math.PI],
  ]
  const pieces: Piece[] = [], runs: Run[] = []
  const type = (len: number): PieceType => (len === L ? 'L' : len === S ? 'S' : 'C')
  const quad = (p: Pt, q: Pt, n: Pt, len: number) =>
    pieces.push({ t: type(len), len, pts: [p, q, [q[0] + B * n[0], q[1] + B * n[1]], [p[0] + B * n[0], p[1] + B * n[1]]] })

  for (let i = 0; i < 4; i++) {
    const D = defs[i]
    if (D.len < -0.5) warns.push(`${SIDE_NAMES[i]}: radijusi su veći od stranice.`)
    if (sides[i] && D.len > 0) {
      const prev = corners[(i + 3) % 4], next = corners[i]
      const sFix = prev.curbed || prev.square, eFix = next.curbed || next.square
      const from = prev.square ? g : 0, to = D.len + (next.square ? B : 0), len = to - from
      const P = (s: number): Pt => [D.o[0] + D.d[0] * s, D.o[1] + D.d[1] * s]
      let r: { seq: number[]; rest: number }, note = ''
      if (sFix && eFix) {
        r = fixedRun(len, g, S, allowS)
        let s = from
        for (const l of r.seq) { quad(P(s), P(s + l), D.nrm, l); s += l + g }
      } else if (!sFix && eFix) {
        r = freeRun(len, g, S, allowS)
        let s = to
        for (const l of r.seq) { quad(P(s - l), P(s), D.nrm, l); s -= l + g }
        note = 'Rezani i kratki komadi idu na slobodni početak.'
      } else {
        r = freeRun(len, g, S, allowS)
        let s = from
        for (const l of r.seq) { quad(P(s), P(s + l), D.nrm, l); s += l + g }
        if (sFix) note = 'Rezani i kratki komadi idu na slobodni kraj.'
      }
      if (r.rest > 0.5) note += ` Ostaje ${f1(r.rest)} cm do kraja linije.`
      runs.push({ label: SIDE_NAMES[i], len, seq: r.seq, S, note: note.trim() })
    }
    const c = corners[i]
    if (c.curbed) {
      const [cx, cy, a0] = centers[i], R = c.R, dt = 2 * Math.asin(arcLen / 2 / R)
      let t = a0 + g / R
      for (let m = 0; m < c.n; m++) {
        const tm = t + dt / 2
        quad([cx + R * Math.cos(t), cy + R * Math.sin(t)], [cx + R * Math.cos(t + dt), cy + R * Math.sin(t + dt)], [Math.cos(tm), Math.sin(tm)], arcLen)
        t += dt + g / R
      }
      const sag = (arcLen / 2) ** 2 / (2 * R), outer = g + B * (dt + g / R)
      runs.push({
        label: CORNER_NAMES[i], len: Math.PI / 2 * R, seq: Array(c.n).fill(arcLen), S,
        note: `R ${f2(R / 100)} m (crtež ${f2(c.R0 / 100)} m). Odstupanje od luka ${f1(sag)} cm, vanjska fuga ~${f1(outer)} cm.`,
      })
    }
  }
  const edges: Edge[] = []
  for (let i = 0; i < 4; i++) {
    const D = defs[i]
    if (D.len > 0) edges.push({ d: `M${D.o[0]} ${D.o[1]}L${D.o[0] + D.d[0] * D.len} ${D.o[1] + D.d[1] * D.len}`, curbed: sides[i], toggle: i, label: SIDE_NAMES[i], mid: [D.o[0] + D.d[0] * D.len / 2, D.o[1] + D.d[1] * D.len / 2], pts: [D.o, [D.o[0] + D.d[0] * D.len, D.o[1] + D.d[1] * D.len]] })
    const c = corners[i]
    if (c.R > 0) {
      const [cx, cy, a0] = centers[i], p0: Pt = [cx + c.R * Math.cos(a0), cy + c.R * Math.sin(a0)], p1: Pt = [cx + c.R * Math.cos(a0 + Math.PI / 2), cy + c.R * Math.sin(a0 + Math.PI / 2)]
      edges.push({ d: `M${p0[0]} ${p0[1]}A${c.R} ${c.R} 0 0 1 ${p1[0]} ${p1[1]}`, curbed: c.curbed, toggle: null, label: CORNER_NAMES[i], mid: [cx + c.R * Math.cos(a0 + Math.PI / 4), cy + c.R * Math.sin(a0 + Math.PI / 4)],
        pts: Array.from({ length: 9 }, (_, m): Pt => [cx + c.R * Math.cos(a0 + (Math.PI / 2) * (m / 8)), cy + c.R * Math.sin(a0 + (Math.PI / 2) * (m / 8))]) })
    }
  }
  const { outlinePts, vertices } = rectOutline(W, H, corners)
  return totalsOf({ W, H, outline: outlinePath(W, H, corners), outlinePts, vertices, edges, corners, pieces, runs, warns }, sh.mode, st, allowS, S, 0)
}

function totalsOf(base: Pick<Layout, 'W' | 'H' | 'outline' | 'outlinePts' | 'vertices' | 'edges' | 'corners' | 'pieces' | 'runs' | 'warns'>, mode: Mode, st: Settings, allowS: boolean, S: number, extraCuts: number): Layout {
  const half = mode === 'half', pieces = base.pieces
  const cuts = pieces.filter((p) => p.t === 'C')
  const fromS = (p: Piece) => allowS && p.len <= S
  const nL = pieces.filter((p) => p.t === 'L').length + cuts.filter((p) => !fromS(p)).length
  const nS = pieces.filter((p) => p.t === 'S').length + cuts.filter(fromS).length
  const halving = half ? Math.ceil(nS / 2) : 0
  const buyL = nL + halving, buyS = half ? 0 : nS
  return {
    ...base, nL, nS, buyL, buyS, half, halving,
    cutCount: cuts.length + halving + extraCuts,
    length: pieces.reduce((a, p) => a + p.len, 0),
    weight: buyL * 36 + buyS * 11, cost: buyL * st.pL + buyS * st.pS,
  }
}

export function seqText(seq: number[], S: number) {
  const parts: string[] = []
  let i = 0
  while (i < seq.length) {
    let j = i
    while (j < seq.length && seq[j] === seq[i]) j++
    const len = seq[i], name = len === L ? '100' : len === S ? (S === 33 ? '33' : '½') : `rez ${f1(len)}`
    parts.push((j - i > 1 ? `${j - i}×` : '') + name)
    i = j
  }
  return parts.join(' + ') || '–'
}

export function outlinePath(W: number, H: number, c: Corner[]) {
  const [tr, br, bl, tl] = c.map((x) => x.R)
  return `M${tl} 0H${W - tr}A${tr} ${tr} 0 0 1 ${W} ${tr}V${H - br}A${br} ${br} 0 0 1 ${W - br} ${H}H${bl}A${bl} ${bl} 0 0 1 0 ${H - bl}V${tl}A${tl} ${tl} 0 0 1 ${tl} 0Z`
}

// World-space bounding box of a shape, rotation included
export function shapeBounds(sh: Shape, lay: Layout) {
  const a = (sh.rot || 0) * Math.PI / 180, cx = lay.W / 2, cy = lay.H / 2
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [px, py] of [[-B, -B], [lay.W + B, -B], [lay.W + B, lay.H + B], [-B, lay.H + B]]) {
    const x = sh.x + cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a)
    const y = sh.y + cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return { x0, y0, x1, y1 }
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

// True outer extent in world space: the surface plus any curb pieces, rotation included
export function outerBounds(sh: Shape, lay: Layout): Box {
  const a = (sh.rot || 0) * Math.PI / 180, cx = lay.W / 2, cy = lay.H / 2, c = Math.cos(a), s = Math.sin(a)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (px: number, py: number) => {
    const x = sh.x + cx + (px - cx) * c - (py - cy) * s, y = sh.y + cy + (px - cx) * s + (py - cy) * c
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  add(0, 0); add(lay.W, 0); add(lay.W, lay.H); add(0, lay.H)
  for (const p of lay.pieces) for (const [px, py] of p.pts) add(px, py)
  return { x0, y0, x1, y1 }
}

// Clear gap between two boxes per axis; null where they overlap on that axis.
// dir is +1 when A sits right of / below B, so moving A by dir*(v-gap) sets the gap to v.
export function gaps(a: Box, b: Box) {
  const gx = a.x0 >= b.x1 ? { gap: a.x0 - b.x1, dir: 1 } : b.x0 >= a.x1 ? { gap: b.x0 - a.x1, dir: -1 } : null
  const gy = a.y0 >= b.y1 ? { gap: a.y0 - b.y1, dir: 1 } : b.y0 >= a.y1 ? { gap: b.y0 - a.y1, dir: -1 } : null
  return { gx, gy }
}

// ---------- imported outlines ----------
const SAG_TOL = 1 // cm a 100 cm chord may stray from the curve before shorter pieces are used
const STRAIGHT_TOL = 1.5 // cm an edge may bulge and still be laid as a straight run

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

// Arc-length walker over an open polyline
class Walk {
  cum: number[]
  constructor(public p: Pt[]) {
    this.cum = [0]
    for (let i = 1; i < p.length; i++) this.cum.push(this.cum[i - 1] + d2(p[i - 1], p[i]))
  }
  get length() { return this.cum[this.cum.length - 1] }
  at(s: number): Pt {
    s = Math.max(0, Math.min(this.length, s))
    let i = 1
    while (i < this.p.length - 1 && this.cum[i] < s) i++
    const seg = this.cum[i] - this.cum[i - 1], t = seg ? (s - this.cum[i - 1]) / seg : 0
    return [this.p[i - 1][0] + (this.p[i][0] - this.p[i - 1][0]) * t, this.p[i - 1][1] + (this.p[i][1] - this.p[i - 1][1]) * t]
  }
  // first point after arc-length s0 lying exactly `dist` (straight line) away from P, before sMax
  chord(P: Pt, s0: number, dist: number, sMax: number): { pt: Pt; s: number } | null {
    let i = 1
    while (i < this.p.length && this.cum[i] <= s0) i++
    let prev = this.at(s0), sPrev = s0
    for (; i < this.p.length; i++) {
      const v = this.cum[i] > sMax ? this.at(sMax) : this.p[i], sv = Math.min(this.cum[i], sMax)
      if (d2(v, P) >= dist) {
        // solve |prev + t (v - prev) - P| = dist on this segment
        const dx = v[0] - prev[0], dy = v[1] - prev[1], fx = prev[0] - P[0], fy = prev[1] - P[1]
        const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - dist * dist
        const t = a ? (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) : 0
        return { pt: [prev[0] + dx * t, prev[1] + dy * t], s: sPrev + (sv - sPrev) * t }
      }
      if (this.cum[i] >= sMax) return null
      prev = v; sPrev = sv
    }
    return null
  }
  // how far the polyline between s0 and s1 strays from the straight chord
  sag(s0: number, s1: number) {
    const a = this.at(s0), b = this.at(s1), L = d2(a, b)
    let m = 0
    for (let i = 0; i < this.p.length; i++) {
      if (this.cum[i] <= s0 || this.cum[i] >= s1) continue
      const p = this.p[i]
      m = Math.max(m, L ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L : d2(a, p))
    }
    return m
  }
  sub(s0: number, s1: number): Pt[] {
    const out: Pt[] = [this.at(s0)]
    for (let i = 0; i < this.p.length; i++) if (this.cum[i] > s0 && this.cum[i] < s1) out.push(this.p[i])
    out.push(this.at(s1))
    return out
  }
}

function layoutOutline(sh: Shape, st: Settings): Layout {
  const k = cmPerPx(st)
  const clean = cleanOutline(sh.path!.pts.map(([x, y]) => [x * k, y * k] as Pt), sh.path!.breaks)
  return layoutRing(clean.pts, clean.breaks, sh.edgeCurbs ?? [], sh.mode, st, sh.wpx * k, sh.hpx * k)
}

// Curbs along any closed ring (cm), split into edges at `breaks`
export function layoutRing(pts: Pt[], breaks: number[], edgeCurbs: boolean[], mode: Mode, st: Settings, W: number, H: number): Layout {
  const g = st.gap
  const allowS = mode !== 'long', S = mode === 'half' ? HALF : 33
  const N = pts.length
  const E = breaks.length
  const curbs = breaks.map((_, i) => edgeCurbs[i] ?? true)
  // y points down, so a positive shoelace sum means clockwise on screen: outward is (dy, -dx)
  let area = 0
  for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1] }
  const out = (d: Pt): Pt => { const l = Math.hypot(d[0], d[1]) || 1; return area > 0 ? [d[1] / l, -d[0] / l] : [-d[1] / l, d[0] / l] }
  const edgePts = (e: number): Pt[] => {
    const a = breaks[e], b = E === 1 ? a + N : breaks[(e + 1) % E] + (e + 1 === E ? N : 0)
    const r: Pt[] = []
    for (let i = a; i <= b; i++) r.push(pts[i % N])
    return r
  }
  const pieces: Piece[] = [], runs: Run[] = [], warns: string[] = [], edges: Edge[] = []
  const perEdge: Piece[][] = []
  const type = (len: number): PieceType => (len === L ? 'L' : len === S ? 'S' : 'C')
  const quad = (p: Pt, q: Pt, len: number): Piece => {
    const n = out([q[0] - p[0], q[1] - p[1]])
    return { t: type(len), len, pts: [p, q, [q[0] + B * n[0], q[1] + B * n[1]], [p[0] + B * n[0], p[1] + B * n[1]]] }
  }

  for (let e = 0; e < E; e++) {
    const ep = edgePts(e)
    const walk = new Walk(ep)
    edges.push({ d: 'M' + ep.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'), curbed: curbs[e], toggle: e, label: `Rub ${e + 1}`, mid: walk.at(walk.length / 2), pts: ep })
    perEdge.push([])
    if (!curbs[e]) continue
    const loop = E === 1
    const sFix = loop || curbs[(e - 1 + E) % E], eFix = loop || curbs[(e + 1) % E]
    const s0 = sFix ? g / 2 : 0, s1 = walk.length - (eFix ? g / 2 : 0)
    if (s1 - s0 < 3) continue
    const straight = !loop && walk.sag(0, walk.length) <= STRAIGHT_TOL
    const list: Piece[] = []
    let note = '', rest = 0, seq: number[] = []
    if (straight) {
      const a = walk.at(s0), b = walk.at(s1), len = d2(a, b), dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      const P = (s: number): Pt => [a[0] + dir[0] * s, a[1] + dir[1] * s]
      if (sFix && eFix) {
        const r = fixedRun(len, g, S, allowS); seq = r.seq; rest = r.rest
        let s = 0
        for (const l of r.seq) { list.push(quad(P(s), P(s + l), l)); s += l + g }
      } else {
        const r = freeRun(len, g, S, allowS); seq = r.seq; rest = r.rest
        if (!sFix && eFix) {
          let s = len
          for (const l of r.seq) { list.unshift(quad(P(s - l), P(s), l)); s -= l + g }
          note = 'Rezani i kratki komadi idu na slobodni početak.'
        } else {
          let s = 0
          for (const l of r.seq) { list.push(quad(P(s), P(s + l), l)); s += l + g }
          if (sFix) note = 'Rezani i kratki komadi idu na slobodni kraj.'
        }
      }
    } else {
      // walk chords along the curve from the fixed end; long pieces where the curve is gentle
      const reverse = !sFix && eFix
      const w = reverse ? new Walk(walk.sub(s0, s1).reverse()) : new Walk(walk.sub(s0, s1))
      const end = w.length, endFixed = reverse ? sFix : eFix
      let s = 0, P = w.at(0), maxSag = 0
      for (let guard = 0; guard < 2000; guard++) {
        let len = L
        let hit = w.chord(P, s, L, end)
        if (allowS && hit && w.sag(s, hit.s) > SAG_TOL) { len = S; hit = w.chord(P, s, S, end) }
        if (!hit) {
          const remain = d2(P, w.at(end))
          if (endFixed ? remain >= 3 : remain >= 15) { const q = w.at(end); list.push(quad(P, q, remain)); seq.push(remain) }
          else rest = remain
          break
        }
        maxSag = Math.max(maxSag, w.sag(s, hit.s))
        list.push(quad(P, hit.pt, len)); seq.push(len)
        const j = w.chord(hit.pt, hit.s, g, end)
        if (!j) break
        s = j.s; P = j.pt
      }
      if (reverse) {
        list.reverse(); seq.reverse()
        for (const pc of list) pc.pts = [pc.pts[1], pc.pts[0], pc.pts[3], pc.pts[2]]
        note = 'Rezani komad ide na slobodni početak.'
      }
      // a chord laid backwards faces inward; flip each piece to the outward side of its own chord
      for (const pc of list) { const n = out([pc.pts[1][0] - pc.pts[0][0], pc.pts[1][1] - pc.pts[0][1]]); pc.pts[2] = [pc.pts[1][0] + B * n[0], pc.pts[1][1] + B * n[1]]; pc.pts[3] = [pc.pts[0][0] + B * n[0], pc.pts[0][1] + B * n[1]] }
      note = `${note} Najveće odstupanje od luka ${f1(maxSag)} cm.`.trim()
    }
    if (rest > 0.5) note += ` Ostaje ${f1(rest)} cm do kraja ruba.`
    perEdge[e] = list
    pieces.push(...list)
    runs.push({ label: `Rub ${e + 1}${straight ? '' : ' (luk)'}`, len: walk.length, seq, S, note: note.trim() })
  }

  // mitre the outer corners where two curbed edges meet at an angle
  let miters = 0
  const cross = (p: Pt, d: Pt, q: Pt, f: Pt): Pt | null => {
    const den = d[0] * f[1] - d[1] * f[0]
    if (Math.abs(den) < 1e-9) return null
    const t = ((q[0] - p[0]) * f[1] - (q[1] - p[1]) * f[0]) / den
    return [p[0] + d[0] * t, p[1] + d[1] * t]
  }
  if (E > 1) for (let e = 0; e < E; e++) {
    const A = perEdge[e], Bn = perEdge[(e + 1) % E]
    if (!A.length || !Bn.length) continue
    const a = A[A.length - 1], b = Bn[0]
    const da: Pt = [a.pts[1][0] - a.pts[0][0], a.pts[1][1] - a.pts[0][1]], db: Pt = [b.pts[1][0] - b.pts[0][0], b.pts[1][1] - b.pts[0][1]]
    const turn = Math.abs(Math.atan2(da[0] * db[1] - da[1] * db[0], da[0] * db[0] + da[1] * db[1])) * 180 / Math.PI
    if (turn < 3) continue
    const x = cross(a.pts[3], da, b.pts[3], db)
    if (!x || d2(x, a.pts[1]) > 3 * B) continue
    a.pts[2] = x; b.pts[3] = x
    miters += 2
    runs[runs.findIndex((r) => r.label.startsWith(`Rub ${e + 1}`))].note += ` Spoj s rubom ${((e + 1) % E) + 1}: kosi rez ${f1(turn / 2)}° na oba komada.`
  }
  for (const r of runs) r.note = r.note.trim()

  const outline = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + 'Z'
  return totalsOf({ W, H, outline, outlinePts: pts, vertices: breaks.map((i) => pts[i]), edges, corners: [], pieces, runs, warns }, mode, st, allowS, S, miters)
}

// Import helper: outline in absolute px → shape fields (pts relative to its bounding box)
export function outlineToShape(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { x0, y0, wpx: x1 - x0, hpx: y1 - y0, pts: pts.map(([x, y]) => [+(x - x0).toFixed(2), +(y - y0).toFixed(2)] as [number, number]) }
}

// Photoshop paths sometimes overshoot: a line runs past where the next curve starts and the curve
// doubles back over it. Drop vertices where the outline reverses (and duplicates), keeping edge starts.
export function cleanOutline(pts: Pt[], breaks: number[]): { pts: Pt[]; breaks: number[] } {
  let list = pts.map((p, i) => ({ p, brk: breaks.includes(i) }))
  const reverses = (a: Pt, b: Pt, c: Pt) => {
    const u: Pt = [b[0] - a[0], b[1] - a[1]], v: Pt = [c[0] - b[0], c[1] - b[1]]
    const lu = Math.hypot(...u), lv = Math.hypot(...v)
    if (lu < 1e-6 || lv < 1e-6) return true
    return (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < -0.94 // turns back by more than ~160°
  }
  let perim = 0
  for (let i = 0; i < pts.length; i++) perim += d2(pts[i], pts[(i + 1) % pts.length])
  // an overshoot retraces only a little; a genuine sharp tip would unwind much further, so it stays
  const maxBack = perim * 0.04
  for (let pass = 0; pass < 4; pass++) {
    const out: typeof list = []
    for (const q of list) {
      const popped: typeof list = []
      let back = 0
      while (out.length >= 2 && reverses(out[out.length - 2].p, out[out.length - 1].p, q.p)) {
        const r = out.pop()!
        back += d2(r.p, popped.length ? popped[popped.length - 1].p : q.p)
        popped.push(r)
        if (back > maxBack) break
      }
      if (back > maxBack) out.push(...popped.reverse())
      else if (popped.some((r) => r.brk)) q.brk = true
      out.push(q)
    }
    // close the loop: check the seam by rotating half way round
    const changed = out.length !== list.length
    list = [...out.slice(out.length >> 1), ...out.slice(0, out.length >> 1)]
    if (!changed && pass > 0) break
  }
  const first = Math.max(0, list.findIndex((q) => q.brk))
  list = [...list.slice(first), ...list.slice(0, first)]
  const b = list.map((q, i) => (q.brk ? i : -1)).filter((i) => i >= 0)
  return { pts: list.map((q) => q.p), breaks: b.length ? b : [0] }
}

// Rectangle outline as a polyline (arcs sampled) plus its corner and tangent points
function rectOutline(W: number, H: number, c: Corner[]) {
  const [tr, br, bl, tl] = c.map((x) => x.R)
  const outlinePts: Pt[] = [], vertices: Pt[] = []
  const arcPts = (cx: number, cy: number, r: number, a0: number) => {
    for (let i = 0; i <= 16; i++) { const t = a0 + (Math.PI / 2) * (i / 16); outlinePts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]) }
  }
  const corner = (r: number, cx: number, cy: number, a0: number, sharp: Pt) => {
    if (r > 0) { arcPts(cx, cy, r, a0); vertices.push(outlinePts[outlinePts.length - 17], outlinePts[outlinePts.length - 1]) }
    else { outlinePts.push(sharp); vertices.push(sharp) }
  }
  corner(tl, tl, tl, Math.PI, [0, 0])
  corner(tr, W - tr, tr, -Math.PI / 2, [W, 0])
  corner(br, W - br, H - br, 0, [W, H])
  corner(bl, bl, H - bl, Math.PI / 2, [0, H])
  return { outlinePts, vertices }
}

// Local shape coordinates → world, the same transform the canvas applies
export function toWorld(sh: Shape, lay: Layout) {
  const a = (sh.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = lay.W / 2, cy = lay.H / 2
  return ([px, py]: Pt): Pt => [sh.x + cx + (px - cx) * c - (py - cy) * s, sh.y + cy + (px - cx) * s + (py - cy) * c]
}

export interface SnapGeo { points: Pt[]; segs: [Pt, Pt][] }

// Everything a ruler end can stick to: outline corners and edges, and the curbs' outer faces
export function snapGeometry(shapes: Shape[], st: Settings, withCurbs = true): SnapGeo {
  const points: Pt[] = [], segs: [Pt, Pt][] = []
  for (const sh of shapes) {
    const lay = layout(sh, st), w = toWorld(sh, lay)
    const o = lay.outlinePts.map(w)
    for (let i = 0; i < o.length; i++) segs.push([o[i], o[(i + 1) % o.length]])
    points.push(...lay.vertices.map(w))
    if (withCurbs) for (const p of lay.pieces) {
      const q = p.pts.map(w)
      segs.push([q[2], q[3]], [q[1], q[2]], [q[3], q[0]])
      points.push(q[2], q[3])
    }
  }
  return { points, segs }
}

// A corner within 60 % of the radius wins; otherwise the nearest edge, then any corner in range
export function snap(geo: SnapGeo, p: Pt, tol: number): { p: Pt; kind: 'point' | 'edge' } | null {
  let bp: Pt | null = null, dp = tol
  for (const q of geo.points) { const d = d2(p, q); if (d < dp) { dp = d; bp = q } }
  let be: Pt | null = null, de = tol
  for (const [a, b] of geo.segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0
    const q: Pt = [a[0] + dx * t, a[1] + dy * t], d = d2(p, q)
    if (d < de) { de = d; be = q }
  }
  if (bp && (dp <= tol * 0.6 || !be)) return { p: bp, kind: 'point' }
  return be ? { p: be, kind: 'edge' } : null
}

// Number of a run's edge as drawn on the plan (1-based), so tables and drawings line up
export const runEdgeNo = (lay: Layout, label: string) => lay.edges.findIndex((e) => e.label === label.replace(' (luk)', '')) + 1
