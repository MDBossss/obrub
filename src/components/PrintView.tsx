import { useMemo, useState } from 'react'
import { f1, f2, layout, runEdgeNo, seqText, toWorld, type Layout, type Pt } from '../geometry'
import { useStore } from '../store'
import { MODES, type Settings, type Shape } from '../types'
import { planItems, totals, type PlanItem } from './Panels'
import { Icon } from './Icon'

type Box = { x0: number; y0: number; x1: number; y1: number }

const grow = (b: Box, p: Pt) => { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]) }

function boxOf(items: PlanItem[], shapes: Shape[], st: Settings): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const it of items) for (const id of it.members) {
    const sh = shapes.find((s) => s.id === id)
    if (!sh) continue
    const lay = layout(sh, st), w = toWorld(sh, lay)
    lay.outlinePts.forEach((p) => grow(b, w(p)))
  }
  for (const it of items) for (const p of it.lay.pieces) for (const q of p.pts) grow(b, it.world ? q : (() => { const sh = shapes.find((s) => s.id === it.first)!; return toWorld(sh, layout(sh, st))(q) })())
  return b
}

const poly = (pts: Pt[]) => pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')

// Static drawing of plan items: surfaces, curb pieces, optional edge numbers and names
function PlanDrawing({ items, all, shapes, st, focus, numbers, names }: {
  items: PlanItem[]; all: PlanItem[]; shapes: Shape[]; st: Settings; focus?: Box; numbers?: boolean; names?: boolean
}) {
  const b = focus ?? boxOf(items, shapes, st)
  const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.06 + 20
  const vb = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad }
  const u = Math.max(vb.w, vb.h) / 100 // one "unit" ≈ 1 % of the drawing, for text and markers
  const focusIds = new Set(items.map((i) => i.id))
  return (
    <svg className="print-plan" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet">
      {all.map((it) => {
        const dim = !focusIds.has(it.id)
        return (
          <g key={it.id} opacity={dim ? 0.25 : 1}>
            {it.members.map((id) => {
              const sh = shapes.find((s) => s.id === id)
              if (!sh) return null
              const lay = layout(sh, st)
              return (
                <g key={id} transform={`translate(${sh.x} ${sh.y}) rotate(${sh.rot || 0} ${lay.W / 2} ${lay.H / 2})`}>
                  <path d={lay.outline} className={`fill-${sh.kind}`} />
                  {!it.world && lay.edges.filter((e) => !e.curbed).map((e, i) => <path key={i} d={e.d} className="print-nocurb" strokeWidth={u * 0.35} />)}
                  {!it.world && lay.pieces.map((p, i) => <polygon key={i} className={`piece piece-${p.t}`} points={poly(p.pts)} />)}
                </g>
              )
            })}
            {it.world && it.lay.edges.filter((e) => !e.curbed).map((e, i) => <path key={i} d={e.d} className="print-nocurb" strokeWidth={u * 0.35} />)}
            {it.world && it.lay.pieces.map((p, i) => <polygon key={i} className={`piece piece-${p.t}`} points={poly(p.pts)} />)}
          </g>
        )
      })}
      {numbers && items.map((it) => {
        const sh = shapes.find((s) => s.id === it.first)!, w = it.world ? (p: Pt) => p : toWorld(sh, layout(sh, st))
        return it.lay.edges.map((e, i) => {
          const m = w(e.mid)
          return (
            <g key={it.id + i} transform={`translate(${m[0]} ${m[1]})`}>
              <circle r={u * 1.6} className={`edge-badge ${e.curbed ? 'on' : ''}`} />
              <text fontSize={u * 1.8} textAnchor="middle" dy={u * 0.65} className="edge-badge-t">{i + 1}</text>
            </g>
          )
        })
      })}
      {names && all.map((it) => {
        const bb = boxOf([it], shapes, st)
        return <text key={it.id} x={(bb.x0 + bb.x1) / 2} y={(bb.y0 + bb.y1) / 2} fontSize={u * 2.4} textAnchor="middle" className="print-name">{it.name}</text>
      })}
      <ScaleBar vb={vb} u={u} />
    </svg>
  )
}

// A bar of a round length in the bottom-left corner, so printed drawings can be measured
function ScaleBar({ vb, u }: { vb: { x: number; y: number; w: number; h: number }; u: number }) {
  const target = vb.w / 5, steps = [50, 100, 200, 500, 1000, 2000, 5000]
  const len = steps.reduce((a, s) => (s <= target ? s : a), steps[0])
  const x = vb.x + u * 2, y = vb.y + vb.h - u * 2.5
  return (
    <g className="print-scale">
      <rect x={x} y={y - u * 0.6} width={len} height={u * 0.6} />
      <text x={x} y={y - u * 1.2} fontSize={u * 1.8}>{len >= 100 ? `${len / 100} m` : `${len} cm`}</text>
    </g>
  )
}

function Legend() {
  return (
    <div className="print-legend">
      <span><i className="piece-L" />Rubnjak 100 cm</span>
      <span><i className="piece-S" />Kratki (33 cm ili pola)</span>
      <span><i className="piece-C" />Rezani komad</span>
      <span><i className="nocurb" />Rub bez rubnjaka</span>
      <span><i className="fill-asfalt" />Asfalt</span>
      <span><i className="fill-trava" />Trava</span>
    </div>
  )
}

const pieceCounts = (lay: Layout) => ({ L: lay.buyL, S: lay.buyS, cuts: lay.cutCount, halving: lay.halving })

export function PrintView() {
  const open = useStore((s) => s.printOpen)
  const shapes = useStore((s) => s.shapes)
  const joins = useStore((s) => s.joins)
  const settings = useStore((s) => s.settings)
  const [detailed, setDetailed] = useState(false)
  const items = useMemo(() => planItems(shapes, joins, settings), [shapes, joins, settings])
  const t = useMemo(() => totals(shapes, settings, joins), [shapes, settings, joins])
  if (!open) return null
  const close = () => useStore.getState().set({ printOpen: false })
  const today = new Date().toLocaleDateString('hr-HR')
  const reserveL = Math.ceil(t.buyL * 1.05), reserveS = Math.ceil(t.buyS * 1.05)
  const pages = 1 + (detailed ? items.length : 0)
  return (
    <div className="print-root">
      <div className="print-bar">
        <strong>Izvoz za ispis</strong>
        <label className="check"><input type="checkbox" id="print-detailed" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} />Detaljniji izvoz (stranica po dijelu)</label>
        <span className="hint">{pages} {pages === 1 ? 'stranica' : pages < 5 ? 'stranice' : 'stranica'} A4</span>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => window.print()}><Icon name="printer" /> Ispiši / spremi kao PDF</button>
        <button type="button" className="icon-btn" aria-label="Zatvori" onClick={close}><Icon name="close" /></button>
      </div>
      <p className="print-tip hint">U prozoru za ispis odaberi pisač ili "Spremi kao PDF". Ako se boje ne vide, uključi "Pozadinske grafike".</p>

      <div className="print-pages">
        <section className="sheet">
          <header className="sheet-head">
            <h1>Plan dvorišta: rubnjaci</h1>
            <span>{today}</span>
          </header>
          <div className="sheet-plan"><PlanDrawing items={items} all={items} shapes={shapes} st={settings} names /></div>
          <Legend />
          <div className="sheet-totals">
            <div><b>{reserveL}</b><span>kom. 100 cm<br />({t.buyL} + 5 % rezerve{t.halving ? `, ${t.halving} za rezanje na pola` : ''})</span></div>
            {t.buyS > 0 && <div><b>{reserveS}</b><span>kom. 33 cm<br />({t.buyS} + 5 % rezerve)</span></div>}
            <div><b>{f1(t.len / 100)} m</b><span>ukupno rubnjaka</span></div>
            <div><b>{t.cuts}</b><span>rezova</span></div>
            <div><b>{f1(t.weight / 1000)} t</b><span>težina</span></div>
            <div><b>{f2(Math.ceil(t.buyL * 1.05) * settings.pL + Math.ceil(t.buyS * 1.05) * settings.pS)} €</b><span>s rezervom ({f2(t.cost)} € bez)</span></div>
          </div>
          <table className="sheet-table">
            <thead><tr><th>Dio</th><th>Duljina</th><th>100 cm</th><th>33 cm</th><th>Rezova</th><th>Cijena</th></tr></thead>
            <tbody>
              {items.map((it) => { const c = pieceCounts(it.lay); return (
                <tr key={it.id}><td><i className={`swatch fill-${it.kind}`} />{it.name}{it.members.length > 1 ? ` (${it.members.length} oblika)` : ''}</td>
                  <td className="n">{f1(it.lay.length / 100)} m</td><td className="n">{c.L}</td><td className="n">{c.S || '–'}</td><td className="n">{c.cuts}</td><td className="n">{f2(it.lay.cost)} €</td></tr>
              ) })}
            </tbody>
          </table>
          <footer className="sheet-foot"><b>Obrub</b> · Cijene: 100 cm {f2(settings.pL)} €, 33 cm {f2(settings.pS)} €. Fuga {f1(settings.gap)} cm. Mjerilo crteža {settings.spx} px = {settings.scm} cm.</footer>
        </section>

        {detailed && items.map((it, n) => {
          const c = pieceCounts(it.lay), focus = boxOf([it], shapes, settings)
          const sh = shapes.find((s) => s.id === it.first)!
          const mode = it.world ? joins.find((j) => j.id === it.id)?.mode : sh.mode
          return (
            <section className="sheet" key={it.id}>
              <header className="sheet-head">
                <h1><i className={`swatch fill-${it.kind}`} />{it.name}</h1>
                <span>{n + 2} / {pages}</span>
              </header>
              <div className="sheet-plan tall"><PlanDrawing items={[it]} all={items} shapes={shapes} st={settings} focus={focus} numbers /></div>
              <Legend />
              <div className="sheet-totals">
                <div><b>{c.L}</b><span>kom. 100 cm{c.halving ? `, ${c.halving} na pola` : ''}</span></div>
                {c.S > 0 && <div><b>{c.S}</b><span>kom. 33 cm</span></div>}
                <div><b>{f1(it.lay.length / 100)} m</b><span>rubnjaka</span></div>
                <div><b>{c.cuts}</b><span>rezova</span></div>
                <div><b>{f2(it.lay.cost)} €</b><span>{mode ? MODES[mode] : ''}</span></div>
              </div>
              {it.lay.warns.map((w) => <p key={w} className="warn">{w}</p>)}
              <table className="sheet-table">
                <thead><tr><th>#</th><th>Rub</th><th>Duljina</th><th>Komadi redom</th><th>Napomena</th></tr></thead>
                <tbody>
                  {it.lay.runs.map((r) => (
                    <tr key={r.label}><td className="n"><span className="edge-num on">{runEdgeNo(it.lay, r.label)}</span></td><td>{r.label}</td><td className="n">{f1(r.len)} cm</td><td className="n wrap">{seqText(r.seq, r.S)}</td><td className="note">{r.note}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}
