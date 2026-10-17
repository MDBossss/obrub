import { useEffect, useRef, useState } from 'react'
import { cmPerPx, f1, f2, layout, seqText, type Layout } from '../geometry'
import { toggleEdge } from '../importSvg'
import { KINDS, MODES, type CornerKey, type Kind, type Mode, type Settings, type Shape, type SideKey } from '../types'

const round = (x: number, d: number) => +x.toFixed(d)

// Text that goes to the plan once the user pauses or leaves the field, so a rename is one undo step
export function NameField({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef({ text, value, onCommit })
  latest.current = { text, value, onCommit }
  const commit = () => { clearTimeout(timer.current); const l = latest.current; if (l.text.trim() && l.text !== l.value) l.onCommit(l.text.trim()) }
  useEffect(() => { if (document.activeElement?.id !== id) setText(value) }, [value, id])
  useEffect(() => () => commit(), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} value={text} onChange={(e) => { setText(e.target.value); clearTimeout(timer.current); timer.current = setTimeout(commit, 600) }}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }} />
    </label>
  )
}

// A number input that keeps what the user is typing until it parses
export function NumField({ value, onChange, label, digits, id, allowNegative }: { value: number; onChange: (v: number) => void; label: string; digits: number; id: string; allowNegative?: boolean }) {
  const [text, setText] = useState(String(round(value, digits)))
  useEffect(() => {
    if (parseFloat(text.replace(',', '.')) !== round(value, digits)) setText(String(round(value, digits)))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="num" htmlFor={id}>
      <span>{label}</span>
      <input id={id} inputMode="decimal" value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value.replace(',', '.'))
          if (Number.isFinite(v) && (allowNegative || v >= 0)) onChange(v)
        }} />
    </label>
  )
}

function DimRow({ title, px, onPx, k, id }: { title: string; px: number; onPx: (v: number) => void; k: number; id: string }) {
  return (
    <div className="dimrow">
      <div className="dimrow-title">{title}</div>
      <NumField id={id + '-px'} label="px" value={px} digits={2} onChange={onPx} />
      <NumField id={id + '-cm'} label="cm" value={px * k} digits={1} onChange={(cm) => onPx(cm / k)} />
    </div>
  )
}

const CORNERS: [CornerKey, string][] = [['tl', 'Gore lijevo'], ['tr', 'Gore desno'], ['bl', 'Dolje lijevo'], ['br', 'Dolje desno']]
const SIDES: [SideKey, string][] = [['t', 'Gore'], ['r', 'Desno'], ['b', 'Dolje'], ['l', 'Lijevo']]

export function ShapeForm({ sh, settings, onChange, idPrefix, inJoin }: { sh: Shape; settings: Settings; onChange: (p: Partial<Shape>) => void; idPrefix: string; inJoin?: boolean }) {
  const k = cmPerPx(settings)
  return (
    <div className="form">
      <NameField key={sh.id} id={idPrefix + '-name'} label="Naziv oblika" value={sh.name} onCommit={(name) => onChange({ name })} />
      <div className="seg" role="radiogroup" aria-label="Vrsta površine">
        {(Object.keys(KINDS) as Kind[]).map((kd) => (
          <button key={kd} type="button" role="radio" aria-checked={sh.kind === kd} className={sh.kind === kd ? 'on' : ''} onClick={() => onChange({ kind: kd })}>
            <i className={`swatch fill-${kd}`} />{KINDS[kd]}
          </button>
        ))}
      </div>
      {sh.path ? <OutlineEdges sh={sh} settings={settings} onChange={onChange} inJoin={inJoin} /> : <>
      <fieldset>
        <legend>Mjere</legend>
        <DimRow id={idPrefix + '-w'} title="Širina" px={sh.wpx} k={k} onPx={(v) => onChange({ wpx: v })} />
        <DimRow id={idPrefix + '-h'} title="Visina" px={sh.hpx} k={k} onPx={(v) => onChange({ hpx: v })} />
      </fieldset>
      <fieldset>
        <legend>Radijusi kutova</legend>
        {CORNERS.map(([c, name]) => (
          <DimRow key={c} id={`${idPrefix}-r${c}`} title={name} px={sh.r[c]} k={k} onPx={(v) => onChange({ r: { ...sh.r, [c]: v } })} />
        ))}
      </fieldset>
      {!inJoin && <fieldset>
        <legend>Rubnjaci na stranicama</legend>
        <div className="sides">
          <SidePicker sides={sh.sides} onToggle={(s) => onChange({ sides: { ...sh.sides, [s]: !sh.sides[s] } })} />
          <div className="checks">
            {SIDES.map(([s, name]) => (
              <label key={s} className="check"><input type="checkbox" checked={sh.sides[s]} onChange={() => onChange({ sides: { ...sh.sides, [s]: !sh.sides[s] } })} />{name}</label>
            ))}
          </div>
        </div>
        <p className="hint">Zaobljeni kut dobiva rubnjake kad ih imaju obje susjedne stranice. Stranicu možeš uključiti i klikom na nju na platnu.</p>
      </fieldset>}
      </>}
      {!inJoin && <label className="field" htmlFor={idPrefix + '-mode'}>
        <span>Rubnjaci</span>
        <select id={idPrefix + '-mode'} value={sh.mode} onChange={(e) => onChange({ mode: e.target.value as Mode })}>
          {(Object.keys(MODES) as Mode[]).map((m) => <option key={m} value={m}>{MODES[m]}</option>)}
        </select>
      </label>}
    </div>
  )
}

// Click a side of the little square to toggle it
function SidePicker({ sides, onToggle }: { sides: Record<SideKey, boolean>; onToggle: (s: SideKey) => void }) {
  const seg = (s: SideKey, d: string) => (
    <path key={s} d={d} className={`sp ${sides[s] ? 'on' : ''}`} onClick={() => onToggle(s)} role="checkbox" aria-checked={sides[s]} aria-label={SIDES.find((x) => x[0] === s)![1]} tabIndex={-1} />
  )
  return (
    <svg viewBox="0 0 64 64" className="sidepicker" aria-hidden="true">
      <rect x="14" y="14" width="36" height="36" rx="3" className="sp-fill" />
      {seg('t', 'M10 6H54V12H10Z')}{seg('r', 'M52 10H58V54H52Z')}{seg('b', 'M10 52H54V58H10Z')}{seg('l', 'M6 10H12V54H6Z')}
    </svg>
  )
}

export function Results({ lay, settings }: { lay: Layout; settings: Settings }) {
  const reserve = Math.ceil(lay.buyL * 1.05) * settings.pL + Math.ceil(lay.buyS * 1.05) * settings.pS
  return (
    <div className="results">
      <div className="stats">
        <div className="stat"><b>{lay.buyS ? `${lay.buyL} + ${lay.buyS}` : `${lay.buyL}`}</b><span>{lay.buyS ? 'kom. 100 + 33 cm' : lay.half ? `kom. 100 cm, ${lay.halving} na pola` : 'kom. 100 cm'}</span></div>
        <div className="stat"><b>{f2(lay.cost)} €</b><span>s rezervom 5 %: {f2(reserve)} €</span></div>
        <div className="stat"><b>{f1(lay.length / 100)} m</b><span>rubnjaka</span></div>
        <div className="stat"><b>{lay.cutCount}</b><span>rezova · {f1(lay.weight / 1000)} t</span></div>
      </div>
      {lay.warns.map((w) => <p key={w} className="warn">{w}</p>)}
      {lay.runs.length ? (
        <table>
          <thead><tr><th>Dio</th><th>Duljina</th><th>Komadi</th></tr></thead>
          <tbody>
            {lay.runs.map((r) => (
              <tr key={r.label}>
                <td>{r.label}{r.note && <div className="hint">{r.note}</div>}</td>
                <td className="n">{f1(r.len)} cm</td>
                <td className="n">{seqText(r.seq, r.S)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="hint">Označi barem jednu stranicu s rubnjacima.</p>}
      <div className="legend"><span><i className="piece-L" />100 cm</span><span><i className="piece-S" />kratki</span><span><i className="piece-C" />rezani</span></div>
    </div>
  )
}

export function ShapePreview({ sh, settings }: { sh: Shape; settings: Settings }) {
  const lay = layout(sh, settings), pad = 60
  return (
    <svg className="preview" viewBox={`${-pad} ${-pad} ${lay.W + 2 * pad} ${lay.H + 2 * pad}`} aria-label="Pregled oblika">
      <path d={lay.outline} className={`fill-${sh.kind}`} />
      {lay.pieces.map((p, i) => <polygon key={i} className={`piece piece-${p.t}`} points={p.pts.map((q) => q.join(',')).join(' ')} />)}
    </svg>
  )
}

// Imported outline: one checkbox per edge, numbered like the badges on the canvas
function OutlineEdges({ sh, settings, onChange, inJoin }: { sh: Shape; settings: Settings; onChange: (p: Partial<Shape>) => void; inJoin?: boolean }) {
  const lay = layout(sh, settings), k = cmPerPx(settings)
  const all = (v: boolean) => onChange({ edgeCurbs: sh.path!.breaks.map(() => v) })
  return (
    <>
      <p className="hint">Obris: {f1(sh.wpx * k / 100)} × {f1(sh.hpx * k / 100)} m ({+sh.wpx.toFixed(1)} × {+sh.hpx.toFixed(1)} px).</p>
      {!inJoin && <fieldset>
        <legend>Rubovi s rubnjakom</legend>
        <div className="edge-list">
          {lay.edges.map((e, i) => (
            <label key={i} className="check">
              <input type="checkbox" checked={e.curbed} onChange={() => toggleEdge(sh, i)} />
              <span className={`edge-num ${e.curbed ? 'on' : ''}`}>{i + 1}</span>
              {lay.runs.find((r) => r.label.startsWith(`Rub ${i + 1}`))?.label.includes('luk') ? 'luk' : 'ravno'}
            </label>
          ))}
        </div>
        <div className="row"><button type="button" onClick={() => all(true)}>Svi</button><button type="button" onClick={() => all(false)}>Nijedan</button></div>
        <p className="hint">Rub uključiš ili isključiš i klikom na njega na platnu. Rubovi bez rubnjaka su crtkani.</p>
      </fieldset>}
    </>
  )
}
