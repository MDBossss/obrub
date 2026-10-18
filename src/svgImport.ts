// Reads closed outlines from an SVG (Photoshop "Export As → SVG" / "Copy SVG") and splits each
// into edges: a new edge starts where the outline turns sharply or switches between line and curve.
import type { Pt } from './geometry'
import { t } from './i18n'

export interface Outline { name: string; pts: Pt[]; breaks: number[] }

type M = [number, number, number, number, number, number] // a b c d e f
const I: M = [1, 0, 0, 1, 0, 0]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: M, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

function parseTransform(t: string | null): M {
  let m = I
  if (!t) return m
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number)
    let n: M = I
    if (fn === 'matrix') n = a.slice(0, 6) as M
    else if (fn === 'translate') n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (fn === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
    else if (fn === 'rotate') {
      const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] ?? 0, cy = a[2] ?? 0
      n = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy])
    }
    m = mul(m, n)
  }
  return m
}

// A raw segment of one subpath: points along it (first = start) and whether it is a curve
interface Seg { curve: boolean; pts: Pt[]; t0: Pt; t1: Pt }

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]

function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt): Seg {
  const approx = dist(p0, c1) + dist(c1, c2) + dist(c2, p3)
  const n = Math.min(240, Math.max(4, Math.ceil(approx / 1.5)))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ])
  }
  const t0 = dist(c1, p0) > 1e-6 ? sub(c1, p0) : sub(c2, p0)
  const t1 = dist(p3, c2) > 1e-6 ? sub(p3, c2) : sub(p3, c1)
  return { curve: true, pts, t0, t1 }
}

function arc(p0: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: Pt): Seg {
  // SVG arc endpoint → centre parameterisation (SVG spec F.6.5), then sampled
  if (!rx || !ry) return line(p0, p1)
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi)
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)))
  const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx
  const cx = cp * cxp - sp * cyp + (p0[0] + p1[0]) / 2, cy = sp * cxp + cp * cyp + (p0[1] + p1[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && dth > 0) dth -= 2 * Math.PI
  if (sweep && dth < 0) dth += 2 * Math.PI
  const n = Math.min(240, Math.max(4, Math.ceil((Math.abs(dth) * Math.max(rx, ry)) / 1.5)))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = th1 + (dth * i) / n
    pts.push([cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp])
  }
  pts[0] = p0; pts[n] = p1
  return { curve: true, pts, t0: sub(pts[1], pts[0]), t1: sub(pts[n], pts[n - 1]) }
}

const line = (a: Pt, b: Pt): Seg => ({ curve: false, pts: [a, b], t0: sub(b, a), t1: sub(b, a) })

function parsePath(d: string): Seg[][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
  const subs: Seg[][] = []
  let segs: Seg[] = [], i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], lastC: Pt | null = null, lastQ: Pt | null = null
  const num = () => Number(toks[i++])
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i])
  const close = () => {
    if (segs.length) {
      if (dist(cur, start) > 1e-6) segs.push(line(cur, start))
      subs.push(segs)
    }
    segs = []
    cur = start
  }
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++]
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    const P = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y])
    if (C === 'Z') { close(); lastC = lastQ = null; continue }
    if (!isNum()) { i++; continue }
    if (C === 'M') {
      if (segs.length) subs.push(segs) // unclosed subpath: kept, closed later
      segs = []
      cur = start = P(num(), num())
      cmd = rel ? 'l' : 'L'
      lastC = lastQ = null
      continue
    }
    let next: Pt
    if (C === 'L') { next = P(num(), num()); segs.push(line(cur, next)); lastC = lastQ = null }
    else if (C === 'H') { const x = num(); next = [rel ? cur[0] + x : x, cur[1]]; segs.push(line(cur, next)); lastC = lastQ = null }
    else if (C === 'V') { const y = num(); next = [cur[0], rel ? cur[1] + y : y]; segs.push(line(cur, next)); lastC = lastQ = null }
    else if (C === 'C' || C === 'S') {
      const c1: Pt = C === 'C' ? P(num(), num()) : lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur
      const c2 = P(num(), num()); next = P(num(), num())
      segs.push(cubic(cur, c1, c2, next)); lastC = c2; lastQ = null
    } else if (C === 'Q' || C === 'T') {
      const q: Pt = C === 'Q' ? P(num(), num()) : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur
      next = P(num(), num())
      const c1: Pt = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])]
      const c2: Pt = [next[0] + (2 / 3) * (q[0] - next[0]), next[1] + (2 / 3) * (q[1] - next[1])]
      segs.push(cubic(cur, c1, c2, next)); lastQ = q; lastC = null
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), la = num(), sw = num()
      next = P(num(), num())
      segs.push(arc(cur, rx, ry, rot, !!la, !!sw, next)); lastC = lastQ = null
    } else { i++; continue }
    cur = next
  }
  if (segs.length) subs.push(segs)
  // close any open subpath back to its start
  return subs.map((ss) => {
    const a = ss[0].pts[0], last = ss[ss.length - 1], b = last.pts[last.pts.length - 1]
    return dist(a, b) > 1e-6 ? [...ss, line(b, a)] : ss
  })
}

const angleBetween = (u: Pt, v: Pt) => {
  const l = Math.hypot(...u) * Math.hypot(...v)
  return l ? Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / l))) : 0
}
const deviation = (pts: Pt[]) => {
  const a = pts[0], b = pts[pts.length - 1], L = dist(a, b)
  if (L < 1e-9) return 0
  return Math.max(...pts.map((p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L))
}

// Build one outline from a closed subpath's segments
function toOutline(segs: Seg[], m: M, name: string, straightTol: number): Outline | null {
  let ss = segs
    .map((s) => ({ ...s, pts: s.pts.map((p) => apply(m, p)), t0: dirOf(m, s.t0), t1: dirOf(m, s.t1) }))
    .filter((s) => dist(s.pts[0], s.pts[s.pts.length - 1]) > 1e-6 || s.pts.length > 2)
  // a nearly straight curve (Photoshop often stores lines as curves) becomes a line
  ss = ss.map((s) => (s.curve && deviation(s.pts) <= straightTol ? line(s.pts[0], s.pts[s.pts.length - 1]) : s))
  if (ss.length < 2) return null
  const n = ss.length
  const isBreak = (k: number) => {
    const a = ss[(k - 1 + n) % n], b = ss[k]
    const turn = angleBetween(a.t1, b.t0)
    if (a.curve !== b.curve) return true
    if (!a.curve) return turn > (1.5 * Math.PI) / 180
    return turn > (12 * Math.PI) / 180
  }
  const breakAt = [...Array(n).keys()].filter(isBreak)
  const first = breakAt.length ? breakAt[0] : 0
  const pts: Pt[] = [], breaks: number[] = []
  for (let j = 0; j < n; j++) {
    const k = (first + j) % n, s = ss[k]
    if (j === 0 || breakAt.includes(k)) breaks.push(pts.length)
    // each segment contributes all but its last point, which the next segment starts on
    for (let q = 0; q < s.pts.length - 1; q++) pts.push(s.pts[q])
  }
  if (pts.length < 3) return null
  return { name, pts, breaks }
}
const dirOf = (m: M, [x, y]: Pt): Pt => [m[0] * x + m[2] * y, m[1] * x + m[3] * y]

function shapeElements(el: Element, m: M, out: { el: Element; m: M; name: string }[], name: string) {
  const own = el.getAttribute('data-name') || el.getAttribute('id') || ''
  const nm = own || name
  const mm = mul(m, parseTransform(el.getAttribute('transform')))
  const tag = el.tagName.toLowerCase()
  if (['defs', 'clippath', 'mask', 'pattern', 'symbol', 'style', 'title', 'metadata'].includes(tag)) return
  if (['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse'].includes(tag)) out.push({ el, m: mm, name: nm })
  for (const c of el.children) shapeElements(c, mm, out, nm)
}

function elementPath(el: Element): string {
  const n = (a: string) => Number(el.getAttribute(a) ?? 0)
  switch (el.tagName.toLowerCase()) {
    case 'path': return el.getAttribute('d') ?? ''
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height')
      let rx = el.hasAttribute('rx') ? n('rx') : n('ry'), ry = el.hasAttribute('ry') ? n('ry') : rx
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2)
      if (!rx || !ry) return `M${x},${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
    }
    case 'polygon': case 'polyline': {
      const v = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
      return v.length >= 4 ? 'M' + v.join(' ') + 'Z' : ''
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.tagName.toLowerCase() === 'circle' ? n('r') : n('rx'), ry = el.tagName.toLowerCase() === 'circle' ? n('r') : n('ry')
      return `M${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx},${cy + ry}A${rx},${ry} 0 0 1 ${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx},${cy - ry}A${rx},${ry} 0 0 1 ${cx + rx},${cy}Z`
    }
  }
  return ''
}

// straightTol is in SVG units (px): curves that bulge less than this count as straight
export function parseSvg(text: string, straightTol = 0.7): Outline[] {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.querySelector('svg')
  if (!root || doc.querySelector('parsererror')) throw new Error(t('Datoteka nije ispravan SVG.'))
  // map viewBox units onto the document's pixel size, the way Photoshop writes them
  let m: M = I
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const w = parseFloat(root.getAttribute('width') ?? ''), h = parseFloat(root.getAttribute('height') ?? '')
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const sx = Number.isFinite(w) && /px$|^\d+(\.\d+)?$/.test(root.getAttribute('width') ?? '') ? w / vb[2] : 1
    const sy = Number.isFinite(h) && /px$|^\d+(\.\d+)?$/.test(root.getAttribute('height') ?? '') ? h / vb[3] : sx
    m = [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy]
  }
  const els: { el: Element; m: M; name: string }[] = []
  for (const c of root.children) shapeElements(c, m, els, '')
  const out: Outline[] = []
  for (const { el, m: mm, name } of els) {
    for (const segs of parsePath(elementPath(el))) {
      const o = toOutline(segs, mm, name, straightTol)
      if (o) out.push(o)
    }
  }
  return out
}
