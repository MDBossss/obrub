import { f1 } from '../geometry'
import { useStore } from '../store'
import { Icon } from './Icon'
import { t } from '../i18n'

type P = [number, number]
const len = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1])

function Line({ a, b, zoom, draft, cut }: { a: P; b: P; zoom: number; draft?: boolean; cut?: boolean }) {
  const t = 6 / zoom, L = len(a, b) || 1, nx = -(b[1] - a[1]) / L * t, ny = (b[0] - a[0]) / L * t
  return (
    <g className={`ruler ${draft ? 'draft' : ''} ${cut ? 'cut' : ''}`}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      <line x1={a[0] - nx} y1={a[1] - ny} x2={a[0] + nx} y2={a[1] + ny} />
      <line x1={b[0] - nx} y1={b[1] - ny} x2={b[0] + nx} y2={b[1] + ny} />
    </g>
  )
}

export function RulerLines({ zoom }: { zoom: number }) {
  const rulers = useStore((s) => s.rulers)
  const draft = useStore((s) => s.rulerDraft)
  const hint = useStore((s) => s.snapHint)
  const cutting = useStore((s) => s.tool === 'cut')
  const r = 5 / zoom
  return (
    <g pointerEvents="none">
      {rulers.map((x) => <Line key={x.id} a={x.a} b={x.b} zoom={zoom} />)}
      {draft && <Line a={draft.a} b={draft.b} zoom={zoom} draft cut={cutting} />}
      {hint && (hint.kind === 'point'
        ? <rect className="snap-hint" x={hint.p[0] - r} y={hint.p[1] - r} width={2 * r} height={2 * r} />
        : <circle className="snap-hint" cx={hint.p[0]} cy={hint.p[1]} r={r} />)}
    </g>
  )
}

function label(a: P, b: P) {
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1])
  return { main: `${f1(len(a, b))} cm`, parts: dx > 1 && dy > 1 ? `↔ ${f1(dx)} · ↕ ${f1(dy)}` : '' }
}

// Distances as HTML over the canvas, each with a delete button
export function RulerLabels() {
  const rulers = useStore((s) => s.rulers)
  const draft = useStore((s) => s.rulerDraft)
  const view = useStore((s) => s.view)
  const pos = (a: P, b: P) => ({ left: ((a[0] + b[0]) / 2 - view.x) * view.zoom, top: ((a[1] + b[1]) / 2 - view.y) * view.zoom })
  return (
    <>
      {rulers.map((r) => {
        const l = label(r.a, r.b)
        return (
          <div key={r.id} className="ruler-label" style={pos(r.a, r.b)}>
            <span><b>{l.main}</b>{l.parts && <small>{l.parts}</small>}</span>
            <button type="button" aria-label={t('Obriši mjerenje')} title={t('Obriši mjerenje')} onClick={() => useStore.getState().removeRuler(r.id)}><Icon name="close" /></button>
          </div>
        )
      })}
      {draft && len(draft.a, draft.b) > 0.5 && (() => {
        const l = label(draft.a, draft.b)
        return <div className="ruler-label draft" style={pos(draft.a, draft.b)}><span><b>{l.main}</b>{l.parts && <small>{l.parts}</small>}</span></div>
      })()}
    </>
  )
}
