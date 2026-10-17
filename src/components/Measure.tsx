import { useState } from 'react'
import { f1, gaps, layout, outerBounds, type Box } from '../geometry'
import { useStore } from '../store'

export type Axis = 'x' | 'y'

export function boxesFor(aId: string, bId: string) {
  const { shapes, settings } = useStore.getState()
  const a = shapes.find((s) => s.id === aId), b = shapes.find((s) => s.id === bId)
  if (!a || !b) return null
  return { a: outerBounds(a, layout(a, settings)), b: outerBounds(b, layout(b, settings)) }
}

// Move the selected shape so its clear gap to the target on one axis becomes v cm
export function setGap(aId: string, bId: string, axis: Axis, v: number) {
  const boxes = boxesFor(aId, bId)
  if (!boxes) return
  const g = gaps(boxes.a, boxes.b)[axis === 'x' ? 'gx' : 'gy']
  if (!g) return
  const st = useStore.getState(), sh = st.shapes.find((s) => s.id === aId)!
  const d = Math.round(g.dir * (v - g.gap) * 10) / 10
  st.moveShape(aId, axis === 'x' ? sh.x + d : sh.x, axis === 'y' ? sh.y + d : sh.y)
}

interface Seg { axis: Axis; x1: number; y1: number; x2: number; y2: number; guide?: [number, number, number, number]; gap: number }

// Figma-style red lines between the two boxes' facing edges
export function measureSegments(a: Box, b: Box): Seg[] {
  const { gx, gy } = gaps(a, b), out: Seg[] = []
  const mid = (p0: number, p1: number, q0: number, q1: number, fallback: number) => {
    const lo = Math.max(p0, q0), hi = Math.min(p1, q1)
    return lo <= hi ? (lo + hi) / 2 : fallback
  }
  if (gx) {
    const y = mid(a.y0, a.y1, b.y0, b.y1, (a.y0 + a.y1) / 2)
    const bx = gx.dir === 1 ? b.x1 : b.x0, ax = gx.dir === 1 ? a.x0 : a.x1
    const by = Math.min(Math.max(y, b.y0), b.y1)
    out.push({ axis: 'x', x1: bx, y1: y, x2: ax, y2: y, gap: gx.gap, guide: by !== y ? [bx, by, bx, y] : undefined })
  }
  if (gy) {
    const x = mid(a.x0, a.x1, b.x0, b.x1, (a.x0 + a.x1) / 2)
    const by = gy.dir === 1 ? b.y1 : b.y0, ay = gy.dir === 1 ? a.y0 : a.y1
    const bx = Math.min(Math.max(x, b.x0), b.x1)
    out.push({ axis: 'y', x1: x, y1: by, x2: x, y2: ay, gap: gy.gap, guide: bx !== x ? [bx, by, x, by] : undefined })
  }
  return out
}

export function MeasureLines({ a, b, zoom }: { a: Box; b: Box; zoom: number }) {
  const segs = measureSegments(a, b), t = 5 / zoom
  return (
    <g className="measure" pointerEvents="none">
      <rect className="measure-box" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />
      {segs.map((s) => (
        <g key={s.axis}>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          {s.axis === 'x'
            ? <><line x1={s.x1} y1={s.y1 - t} x2={s.x1} y2={s.y1 + t} /><line x1={s.x2} y1={s.y2 - t} x2={s.x2} y2={s.y2 + t} /></>
            : <><line x1={s.x1 - t} y1={s.y1} x2={s.x1 + t} y2={s.y1} /><line x1={s.x2 - t} y1={s.y2} x2={s.x2 + t} y2={s.y2} /></>}
          {s.guide && <line className="measure-guide" x1={s.guide[0]} y1={s.guide[1]} x2={s.guide[2]} y2={s.guide[3]} />}
        </g>
      ))}
    </g>
  )
}

// HTML labels over the canvas; when the target is pinned they turn into editable fields
export function MeasureLabels() {
  const selected = useStore((s) => s.selected)
  const pinned = useStore((s) => s.measureTo)
  const hover = useStore((s) => s.measureHover)
  const view = useStore((s) => s.view)
  useStore((s) => s.shapes)
  useStore((s) => s.settings)
  const target = hover ?? pinned
  if (!selected || !target || target === selected) return null
  const boxes = boxesFor(selected, target)
  if (!boxes) return null
  const segs = measureSegments(boxes.a, boxes.b)
  const toScreen = (x: number, y: number) => ({ left: (x - view.x) * view.zoom, top: (y - view.y) * view.zoom })
  const editable = !hover || hover === pinned
  if (!segs.length) {
    const p = toScreen((boxes.a.x0 + boxes.a.x1) / 2, boxes.a.y0)
    return <div className="measure-label static" style={p}>preklapaju se</div>
  }
  return (
    <>
      {segs.map((s) => (
        <GapLabel key={s.axis} seg={s} pos={toScreen((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)} editable={editable}
          onCommit={(v) => setGap(selected, target, s.axis, v)} />
      ))}
    </>
  )
}

function GapLabel({ seg, pos, editable, onCommit }: { seg: Seg; pos: { left: number; top: number }; editable: boolean; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const name = seg.axis === 'x' ? 'Vodoravna udaljenost' : 'Okomita udaljenost'
  if (!editable) return <div className="measure-label static" style={pos}>{f1(seg.gap)} cm</div>
  if (editing) {
    const commit = () => {
      const v = parseFloat(text.replace(',', '.'))
      if (Number.isFinite(v) && v >= 0) onCommit(v)
      setEditing(false)
    }
    return (
      <input className="measure-label measure-input" style={pos} autoFocus aria-label={`${name} u cm`} inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
    )
  }
  return (
    <button type="button" className="measure-label" style={pos} title={`${name}: klikni i upiši cm`}
      onClick={() => { setText(String(+seg.gap.toFixed(1))); setEditing(true) }}>
      {f1(seg.gap)} cm
    </button>
  )
}
