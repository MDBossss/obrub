import { useEffect, useMemo, useRef, useState } from 'react'
import { layout, outerBounds, f1, snap as snapTo, snapGeometry, toWorld, type Layout, type Pt, type SnapGeo } from '../geometry'
import { joinLayout, type JoinLayout } from '../join'
import { cutShapes } from '../cut'
import { RulerLines } from './Ruler'
import { newId } from '../store'
import { importSvgFile, toggleEdge } from '../importSvg'
import { MeasureLines } from './Measure'
import { pauseHistory, resumeHistory, useStore, type View } from '../store'
import type { Join, Shape } from '../types'
import { t } from '../i18n'

const MIN_ZOOM = 0.02, MAX_ZOOM = 8
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const zoom = clampZoom(view.zoom * factor)
  const wx = view.x + sx / view.zoom, wy = view.y + sy / view.zoom
  return { zoom, x: wx - sx / zoom, y: wy - sy / zoom }
}

type Gesture =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; origin: Map<string, [number, number]>; moved: boolean; others: SnapGeo; mine: SnapGeo; myCorners: Pt[]; theirCorners: Pt[] }
  | { kind: 'pan'; sx: number; sy: number; v: View; moved: boolean }
  | { kind: 'pinch'; d0: number; mid0: [number, number]; v: View }
  | { kind: 'ruler'; sx: number; sy: number; moved: boolean }

export function Canvas({ spaceDown }: { spaceDown: boolean }) {
  const shapes = useStore((s) => s.shapes)
  const settings = useStore((s) => s.settings)
  const selected = useStore((s) => s.selected)
  const selection = useStore((s) => s.selection)
  const joins = useStore((s) => s.joins)
  const measureTo = useStore((s) => s.measureTo)
  const measureHover = useStore((s) => s.measureHover)
  const view = useStore((s) => s.view)
  const tool = useStore((s) => s.tool)
  const snap = useStore((s) => s.snap)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, [number, number]>())
  const gesture = useRef<Gesture | null>(null)
  const [panning, setPanning] = useState(false)

  const layouts = useMemo(() => new Map(shapes.map((s) => [s.id, layout(s, settings)])), [shapes, settings])
  const snapGeo = useMemo(() => snapGeometry(shapes, settings), [shapes, settings])
  const joinLays = useMemo(() => joins.map((j) => ({ j, lay: joinLayout(j, shapes, settings) })), [joins, shapes, settings])
  const joinedIds = useMemo(() => new Set(joins.flatMap((j) => j.members)), [joins])

  // pointer → world point, stuck to the nearest corner or edge unless Alt is held; Shift locks to 45° steps from `from`
  const rulerPoint = (e: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }, from?: Pt) => {
    const st = useStore.getState(), [sx, sy] = local(e), v = st.view
    let p: Pt = [v.x + sx / v.zoom, v.y + sy / v.zoom]
    if (from && e.shiftKey) {
      const dx = p[0] - from[0], dy = p[1] - from[1], L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      p = [from[0] + L * Math.cos(a), from[1] + L * Math.sin(a)]
      st.set({ snapHint: null })
      return p
    }
    const hit = e.altKey ? null : snapTo(snapGeo, p, 10 / v.zoom)
    st.set({ snapHint: hit })
    return hit ? hit.p : p
  }
  const finishRuler = () => {
    const st = useStore.getState(), d = st.rulerDraft
    st.set({ rulerDraft: null, snapHint: null })
    if (!d || Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) <= 1) return
    if (st.tool === 'cut') { const msg = cutShapes(d.a, d.b); if (msg) st.set({ toast: msg }) }
    else st.addRuler({ id: newId(), a: d.a, b: d.b })
  }

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // wheel: pan; ctrl/cmd + wheel (and trackpad pinch) zooms at the cursor
  useEffect(() => {
    const el = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = useStore.getState().view
      if (e.ctrlKey || e.metaKey) {
        const [sx, sy] = local(e)
        useStore.getState().set({ view: zoomAt(v, Math.exp(-e.deltaY * 0.01), sx, sy) })
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        useStore.getState().set({ view: { ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom } })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handMode = tool === 'hand' || spaceDown

  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    if (pointers.current.size === 2) {
      const g = gesture.current
      if (g?.kind === 'move') { resumeHistory(); useStore.getState().moveShapes(g.ids.map((id) => ({ id, x: g.origin.get(id)![0], y: g.origin.get(id)![1] }))) }
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: useStore.getState().view }
      return
    }
    if (pointers.current.size > 2) return
    const target = (e.target as Element).closest('[data-shape]') as SVGGElement | null
    const st = useStore.getState()
    const edge = (e.target as Element).closest('[data-edge]') as SVGPathElement | null
    const jedge = (e.target as Element).closest('[data-join-edge]') as SVGPathElement | null
    if (jedge && !handMode && tool === 'select') {
      const j = st.joins.find((x) => x.id === jedge.dataset.join)!, lay = joinLayout(j, st.shapes, st.settings)
      if (lay) {
        const curbs = lay.edges.map((e) => e.curbed), i = Number(jedge.dataset.joinEdge)
        curbs[i] = !curbs[i]
        st.updateJoin(j.id, { edgeCurbs: curbs })
      }
      pointers.current.delete(e.pointerId)
      return
    }
    if (edge && target && !handMode && target.dataset.shape === st.selected) {
      toggleEdge(st.shapes.find((s) => s.id === st.selected)!, Number(edge.dataset.edge))
      pointers.current.delete(e.pointerId)
      return
    }
    if (target && e.altKey && st.selected && target.dataset.shape !== st.selected) {
      st.set({ measureTo: target.dataset.shape!, measureHover: null })
      return
    }
    if ((tool === 'ruler' || tool === 'cut') && !spaceDown && e.button === 0) {
      const [sx, sy] = local(e), d = st.rulerDraft
      if (d) { st.set({ rulerDraft: { a: d.a, b: rulerPoint(e, d.a) } }); finishRuler(); gesture.current = null; return }
      const p = rulerPoint(e)
      st.set({ rulerDraft: { a: p, b: p } })
      gesture.current = { kind: 'ruler', sx, sy, moved: false }
      return
    }
    if (target && !handMode && e.button === 0) {
      const id = target.dataset.shape!
      if (e.shiftKey) { st.toggleSelect(id); pointers.current.delete(e.pointerId); return }
      // dragging one of several selected shapes moves them all
      const ids = st.selection.includes(id) && st.selection.length > 1 ? st.selection : [id]
      if (ids.length === 1) st.select(id)
      else useStore.setState({ selected: id })
      const [sx, sy] = local(e)
      const moving = st.shapes.filter((s) => ids.includes(s.id)), rest = st.shapes.filter((s) => !ids.includes(s.id))
      const corners = (list: Shape[]) => list.flatMap((s) => { const l = layout(s, st.settings); return l.vertices.map(toWorld(s, l)) })
      pauseHistory()
      gesture.current = {
        kind: 'move', ids, startX: sx, startY: sy, moved: false,
        origin: new Map(moving.map((s) => [s.id, [s.x, s.y] as [number, number]])),
        others: snapGeometry(rest, st.settings, false), mine: snapGeometry(moving, st.settings, false),
        myCorners: corners(moving), theirCorners: corners(rest),
      }
    } else {
      const [sx, sy] = local(e)
      gesture.current = { kind: 'pan', sx, sy, v: st.view, moved: false }
      setPanning(true)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) && (tool === 'ruler' || tool === 'cut')) {
      const d = useStore.getState().rulerDraft
      const p = rulerPoint(e, d?.a)
      if (d) useStore.getState().set({ rulerDraft: { a: d.a, b: p } })
      return
    }
    if (!pointers.current.has(e.pointerId)) {
      const st = useStore.getState()
      const over = (e.target as Element).closest('[data-shape]') as SVGGElement | null
      const id = e.altKey && st.selected && over && over.dataset.shape !== st.selected ? over.dataset.shape! : null
      if (id !== st.measureHover) st.set({ measureHover: id })
      return
    }
    pointers.current.set(e.pointerId, local(e))
    const g = gesture.current, st = useStore.getState()
    if (!g) return
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const zoom = clampZoom(g.v.zoom * d / g.d0)
      const wx = g.v.x + g.mid0[0] / g.v.zoom, wy = g.v.y + g.mid0[1] / g.v.zoom
      st.set({ view: { zoom, x: wx - mid[0] / zoom, y: wy - mid[1] / zoom } })
    } else if (g.kind === 'move') {
      const [sx, sy] = local(e)
      const dx = (sx - g.startX) / st.view.zoom, dy = (sy - g.startY) / st.view.zoom
      if (!g.moved && Math.hypot(sx - g.startX, sy - g.startY) < 3) return
      g.moved = true
      const step = snap && !e.altKey ? 10 : 1
      let ddx = Math.round(dx / step) * step, ddy = Math.round(dy / step) * step
      // magnetic edges: a corner of the moved shapes onto the others' outline, or theirs onto ours
      let hint: { p: Pt; kind: 'point' | 'edge' } | null = null
      if (!e.altKey) {
        const tol = 10 / st.view.zoom
        let best: { ox: number; oy: number; d: number; p: Pt; kind: 'point' | 'edge' } | null = null
        for (const c of g.myCorners) {
          const p: Pt = [c[0] + dx, c[1] + dy], h = snapTo(g.others, p, tol)
          if (h) { const ox = h.p[0] - p[0], oy = h.p[1] - p[1], d = Math.hypot(ox, oy); if (!best || d < best.d) best = { ox, oy, d, p: h.p, kind: h.kind } }
        }
        for (const w of g.theirCorners) {
          const h = snapTo(g.mine, [w[0] - dx, w[1] - dy], tol)
          if (h) { const ox = w[0] - dx - h.p[0], oy = w[1] - dy - h.p[1], d = Math.hypot(ox, oy); if (!best || d < best.d) best = { ox, oy, d, p: w, kind: h.kind } }
        }
        if (best) { ddx = dx + best.ox; ddy = dy + best.oy; hint = { p: best.p, kind: best.kind } }
      }
      st.set({ snapHint: hint })
      st.moveShapes(g.ids.map((id) => ({ id, x: g.origin.get(id)![0] + ddx, y: g.origin.get(id)![1] + ddy })))
    } else if (g.kind === 'ruler') {
      const [sx, sy] = local(e), d = st.rulerDraft
      if (Math.hypot(sx - g.sx, sy - g.sy) > 6) g.moved = true
      if (d) st.set({ rulerDraft: { a: d.a, b: rulerPoint(e, d.a) } })
    } else if (g.kind === 'pan') {
      const [sx, sy] = local(e)
      if (Math.hypot(sx - g.sx, sy - g.sy) > 3) g.moved = true
      st.set({ view: { ...g.v, x: g.v.x - (sx - g.sx) / g.v.zoom, y: g.v.y - (sy - g.sy) / g.v.zoom } })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size > 0) {
      // pinch released one finger: continue as a pan with the remaining one
      if (g?.kind === 'pinch') {
        const [p] = [...pointers.current.values()]
        gesture.current = { kind: 'pan', sx: p[0], sy: p[1], v: useStore.getState().view, moved: true }
      }
      return
    }
    if (g?.kind === 'move') {
      if (g.moved) {
        // record the whole drag as one undo step
        const st = useStore.getState()
        const end = g.ids.map((id) => { const s = st.shapes.find((x) => x.id === id)!; return { id, x: s.x, y: s.y } })
        st.moveShapes(g.ids.map((id) => ({ id, x: g.origin.get(id)![0], y: g.origin.get(id)![1] })))
        resumeHistory()
        st.moveShapes(end)
      } else {
        resumeHistory()
        // a plain click on one of several selected shapes narrows the selection to it
        if (g.ids.length > 1) useStore.getState().select(useStore.getState().selected)
      }
      useStore.getState().set({ snapHint: null })
    }
    // drag-to-measure finishes on release; a plain click waits for the second click
    if (g?.kind === 'ruler' && g.moved) finishRuler()
    if (g?.kind === 'pan' && !g.moved && !handMode) useStore.getState().select(null)
    gesture.current = null
    setPanning(false)
  }

  const z = view.zoom
  const cursor = handMode ? (panning ? 'grabbing' : 'grab') : tool === 'ruler' || tool === 'cut' ? 'crosshair' : 'default'
  const gridStep = z * 100 >= 12 ? 100 : z * 500 >= 12 ? 500 : 1000

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={async (e) => {
        e.preventDefault()
        const f = [...e.dataTransfer.files].find((x) => /svg/i.test(x.type) || /\.svg$/i.test(x.name))
        if (f) useStore.getState().set({ toast: await importSvgFile(f) })
      }}
      role="application"
      aria-label={t('Plan dvorišta')}
    >
      <defs>
        <pattern id="grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M${gridStep} 0H0V${gridStep}`} className="grid-line" />
        </pattern>
      </defs>
      <g transform={`scale(${z}) translate(${-view.x} ${-view.y})`}>
        <rect x={view.x} y={view.y} width={10000 / z} height={10000 / z} fill="url(#grid)" />
        {shapes.map((s) => (
          <ShapeView key={s.id} sh={s} lay={layouts.get(s.id)!} selected={selection.includes(s.id)} primary={s.id === selected && selection.length <= 1}
            joined={joinedIds.has(s.id)} zoom={z} grabbable={!handMode} />
        ))}
        {joinLays.map(({ j, lay }) => lay && <JoinView key={j.id} j={j} lay={lay} zoom={z} active={!!selected && j.members.includes(selected)} />)}
        {(() => {
          const t = measureHover ?? measureTo, a = shapes.find((s) => s.id === selected), b = shapes.find((s) => s.id === t)
          return a && b && a !== b ? <MeasureLines a={outerBounds(a, layouts.get(a.id)!)} b={outerBounds(b, layouts.get(b.id)!)} zoom={z} /> : null
        })()}
        <RulerLines zoom={z} />
      </g>
    </svg>
  )
}

function JoinView({ j, lay, zoom, active }: { j: Join; lay: JoinLayout; zoom: number; active: boolean }) {
  if (lay.error) return null
  return (
    <g className="join">
      {lay.edges.filter((e) => !e.curbed).map((e, i) => <path key={'n' + i} d={e.d} className="edge-off" />)}
      {lay.pieces.map((p, i) => <polygon key={i} className={`piece piece-${p.t}`} points={p.pts.map((q) => q.join(',')).join(' ')} />)}
      {active && lay.edges.map((e, i) => (
        <g key={'h' + i}>
          <path d={e.d} className={`edge-hit ${e.curbed ? 'on' : ''}`} data-join={j.id} data-join-edge={i} strokeWidth={14 / zoom}>
            <title>{t(e.curbed ? 'Klikni: makni rubnjak s ovog ruba spoja' : 'Klikni: dodaj rubnjak na ovaj rub spoja')}</title>
          </path>
          <g transform={`translate(${e.mid[0]} ${e.mid[1]})`} pointerEvents="none">
            <circle r={9 / zoom} className={`edge-badge ${e.curbed ? 'on' : ''}`} />
            <text fontSize={10 / zoom} textAnchor="middle" dy={3.5 / zoom} className="edge-badge-t">{i + 1}</text>
          </g>
        </g>
      ))}
    </g>
  )
}

function ShapeView({ sh, lay, selected, primary, joined, zoom, grabbable }: { sh: Shape; lay: Layout; selected: boolean; primary: boolean; joined: boolean; zoom: number; grabbable: boolean }) {
  const fs = 13 / zoom
  return (
    <g data-shape={sh.id} transform={`translate(${sh.x} ${sh.y}) rotate(${sh.rot || 0} ${lay.W / 2} ${lay.H / 2})`} style={{ cursor: grabbable ? 'move' : undefined }}>
      <path d={lay.outline} className={`fill-${sh.kind}`} />
      {!joined && lay.edges.filter((e) => !e.curbed).map((e, i) => <path key={'n' + i} d={e.d} className="edge-off" />)}
      {!joined && lay.pieces.map((p, i) => (
        <polygon key={i} className={`piece piece-${p.t}`} points={p.pts.map((q) => q.join(',')).join(' ')} />
      ))}
      {selected && !primary && <rect className="sel" x={-15} y={-15} width={lay.W + 30} height={lay.H + 30} />}
      {primary && (
        <>
          {!joined && lay.edges.map((e, i) => e.toggle === null ? null : (
            <path key={'h' + i} d={e.d} className={`edge-hit ${e.curbed ? 'on' : ''}`} data-edge={e.toggle} strokeWidth={14 / zoom}>
              <title>{t(e.curbed ? 'Klikni: makni rubnjak s ovog ruba' : 'Klikni: dodaj rubnjak na ovaj rub')}</title>
            </path>
          ))}
          {sh.path && !joined && lay.edges.map((e, i) => (
            <g key={'b' + i} transform={`translate(${e.mid[0]} ${e.mid[1]}) rotate(${-(sh.rot || 0)})`} pointerEvents="none">
              <circle r={9 / zoom} className={`edge-badge ${e.curbed ? 'on' : ''}`} />
              <text fontSize={10 / zoom} textAnchor="middle" dy={3.5 / zoom} className="edge-badge-t">{i + 1}</text>
            </g>
          ))}
          <rect className="sel" x={-15} y={-15} width={lay.W + 30} height={lay.H + 30} />
          <Dim x1={0} y1={-15 - 22 / zoom} x2={lay.W} y2={-15 - 22 / zoom} text={`${f1(lay.W)} cm · ${+sh.wpx.toFixed(1)} px`} zoom={zoom} />
          <Dim x1={lay.W + 15 + 22 / zoom} y1={0} x2={lay.W + 15 + 22 / zoom} y2={lay.H} text={`${f1(lay.H)} cm · ${+sh.hpx.toFixed(1)} px`} zoom={zoom} vertical />
        </>
      )}
      <g transform={`rotate(${-(sh.rot || 0)} ${lay.W / 2} ${lay.H / 2})`} pointerEvents="none">
        <text className="shape-name" x={lay.W / 2} y={lay.H / 2 - fs * 0.45} fontSize={fs * 1.1} textAnchor="middle">{sh.name}</text>
        <text className="shape-dims" x={lay.W / 2} y={lay.H / 2 + fs * 0.95} fontSize={fs * 0.85} textAnchor="middle">
          {`${f1(lay.W / 100)} × ${f1(lay.H / 100)} m`}
        </text>
      </g>
    </g>
  )
}

function Dim({ x1, y1, x2, y2, text, zoom, vertical }: { x1: number; y1: number; x2: number; y2: number; text: string; zoom: number; vertical?: boolean }) {
  const t = 5 / zoom, fs = 11 / zoom
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  return (
    <g className="dim" pointerEvents="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical
        ? <><line x1={x1 - t} y1={y1} x2={x1 + t} y2={y1} /><line x1={x2 - t} y1={y2} x2={x2 + t} y2={y2} /></>
        : <><line x1={x1} y1={y1 - t} x2={x1} y2={y1 + t} /><line x1={x2} y1={y2 - t} x2={x2} y2={y2 + t} /></>}
      <text x={mx} y={my} fontSize={fs} textAnchor="middle" dy={vertical ? 0 : -fs * 0.5}
        transform={vertical ? `rotate(90 ${mx} ${my}) translate(0 ${-fs * 0.5})` : undefined}>{text}</text>
    </g>
  )
}
