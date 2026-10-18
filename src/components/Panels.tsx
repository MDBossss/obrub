import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore as useZustand } from 'zustand'
import type { TemporalState } from 'zundo'
import { f1, f2, gaps, layout, shapeBounds, type Layout } from '../geometry'
import { exportJSON, importJSON } from '../persist'
import { importSvgFile, importSvgText } from '../importSvg'
import { newId, redo, undo, useStore, type View } from '../store'
import { MODES, type Join, type Settings, type Shape } from '../types'
import { zoomAt } from './Canvas'
import { NameField, NumField, Results, ShapeForm, ShapePreview } from './ShapeForm'
import { boxesFor, setGap } from './Measure'
import { joinLayout, joinOf, type JoinLayout } from '../join'
import { Icon } from './Icon'
import { getLang, setLang, t } from '../i18n'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const mod = isMac ? '⌘' : 'Ctrl'

function canvasSize() {
  const el = document.querySelector('.canvas')
  const r = el?.getBoundingClientRect()
  return { w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight }
}

export function fitView(onlyId?: string) {
  const { shapes, settings } = useStore.getState()
  const list = onlyId ? shapes.filter((s) => s.id === onlyId) : shapes
  if (!list.length) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of list) {
    const b = shapeBounds(s, layout(s, settings))
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
  }
  const { w, h } = canvasSize(), pad = 80
  const zoom = Math.min(4, Math.max(0.02, Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad - 60) / (y1 - y0))))
  useStore.getState().set({ view: { zoom, x: (x0 + x1) / 2 - w / 2 / zoom, y: (y0 + y1) / 2 - h / 2 / zoom } })
}

export function zoomBy(f: number) {
  const { w, h } = canvasSize()
  useStore.getState().set({ view: zoomAt(useStore.getState().view, f, w / 2, h / 2) })
}
export function zoomReset() {
  const { w, h } = canvasSize(), v: View = useStore.getState().view
  useStore.getState().set({ view: zoomAt(v, 1 / v.zoom, w / 2, h / 2) })
}

// What gets curbs: every shape on its own, except joined shapes, which count once as their join
export interface PlanItem { id: string; name: string; kind: string; lay: Layout; first: string; members: string[]; world: boolean }

export function planItems(shapes: Shape[], joins: Join[], settings: Settings) {
  const joined = new Set(joins.flatMap((j) => j.members))
  // a join's layout is in world coordinates; a shape's is local to the shape
  const items: PlanItem[] = []
  for (const j of joins) {
    const lay = joinLayout(j, shapes, settings)
    if (lay) items.push({ id: j.id, name: j.name, kind: shapes.find((s) => s.id === j.members[0])?.kind ?? 'asfalt', lay, first: j.members[0], members: j.members, world: true })
  }
  for (const s of shapes) if (!joined.has(s.id)) items.push({ id: s.id, name: s.name, kind: s.kind, lay: layout(s, settings), first: s.id, members: [s.id], world: false })
  return items
}

export function totals(shapes: Shape[], settings: Settings, joins: Join[] = []) {
  const t = { buyL: 0, buyS: 0, halving: 0, cost: 0, weight: 0, cuts: 0, len: 0 }
  for (const { lay: l } of planItems(shapes, joins, settings)) {
    t.buyL += l.buyL; t.buyS += l.buyS; t.halving += l.halving; t.cost += l.cost; t.weight += l.weight; t.cuts += l.cutCount; t.len += l.length
  }
  return t
}

// ---------- top-left: main menu + save status ----------
export function MainMenu() {
  const [open, setOpen] = useState(false)
  const saveState = useStore((s) => s.saveState)
  const fileRef = useRef<HTMLInputElement>(null)
  const svgRef = useRef<HTMLInputElement>(null)
  const status = t({ saved: 'Spremljeno', saving: 'Spremam…', error: 'Greška pri spremanju', offline: 'Spremljeno samo u pregledniku' }[saveState])
  const item = (label: string, fn: () => void, kbd?: string) => (
    <button type="button" role="menuitem" onClick={() => { setOpen(false); fn() }}>{label}{kbd && <kbd>{kbd}</kbd>}</button>
  )
  return (
    <div className="menu-wrap">
      <button type="button" className="icon-btn" aria-label={t('Izbornik')} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
      <span className="brand">Obrub</span>
      <span className={`save save-${saveState}`} role="status">{status}</span>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            {item(t('Novi oblik'), () => useStore.getState().set({ builderOpen: true }), 'N')}
            {item(t('Uvezi SVG iz Photoshopa'), () => svgRef.current?.click())}
            {item(t('Zalijepi SVG kod'), () => useStore.getState().set({ pasteOpen: true }), `${mod}+V`)}
            {item(t('Postavke i cijene'), () => useStore.getState().set({ settingsOpen: true }))}
            {item(t('Izvezi plan (.json)'), exportJSON)}
            {item(t('Otvori plan (.json)'), () => fileRef.current?.click())}
            {useStore.getState().rulers.length > 0 && item(t('Obriši sva mjerenja'), () => useStore.getState().removeRuler(null))}
            {item(t('Izvoz za ispis (PDF)'), () => useStore.getState().set({ printOpen: true }), `${mod}+P`)}
            {item(t('Prečaci'), () => useStore.getState().set({ helpOpen: true }), '?')}
            {item('English / Hrvatski', () => setLang(getLang() === 'en' ? 'hr' : 'en'))}
          </div>
        </>
      )}
      <input ref={svgRef} type="file" accept="image/svg+xml,.svg" hidden data-testid="svg-input"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { useStore.getState().set({ toast: await importSvgFile(f) }); requestAnimationFrame(() => fitView()) } }} />
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = '' }} />
    </div>
  )
}

// ---------- top-centre / mobile bottom: tools ----------
export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const set = useStore((s) => s.set)
  const snap = useStore((s) => s.snap)
  return (
    <div className="toolbar" role="toolbar" aria-label={t('Alati')}>
      <button type="button" className={`tool ${tool === 'select' ? 'on' : ''}`} aria-pressed={tool === 'select'} title={t('Odabir (V)')} onClick={() => set({ tool: 'select' })}><Icon name="pointer" /><kbd>V</kbd></button>
      <button type="button" className={`tool ${tool === 'hand' ? 'on' : ''}`} aria-pressed={tool === 'hand'} title={t('Pomicanje pogleda (H ili razmaknica)')} onClick={() => set({ tool: 'hand' })}><Icon name="hand" /><kbd>H</kbd></button>
      <button type="button" className={`tool ${tool === 'ruler' ? 'on' : ''}`} aria-pressed={tool === 'ruler'} title={t('Ravnalo (M): klik-klik ili povuci, Shift za 45°, Alt bez lijepljenja')} onClick={() => set({ tool: 'ruler' })}><Icon name="ruler" /><kbd>M</kbd></button>
      <button type="button" className={`tool ${tool === 'cut' ? 'on' : ''}`} aria-pressed={tool === 'cut'} title={t('Nož (K): povuci crtu preko cijelog oblika da ga prerežeš')} onClick={() => set({ tool: 'cut' })}><Icon name="scissors" /><kbd>K</kbd></button>
      <button type="button" className={`tool ${snap ? 'on' : ''}`} aria-pressed={snap} title={t('Poravnanje na 10 cm ({key})', { key: `${mod}+'` })} onClick={() => set({ snap: !snap })}><Icon name="grid" /></button>
      <span className="sep" />
      <button type="button" className="tool primary" title={t('Novi oblik (N)')} onClick={() => set({ builderOpen: true })}><Icon name="plus" /><span className="tool-label">{t('Novi oblik')}</span></button>
    </div>
  )
}

// ---------- bottom-left: zoom + undo ----------
export function ZoomBar() {
  const zoom = useStore((s) => s.view.zoom)
  return (
    <div className="zoombar">
      <div className="group">
        <button type="button" className="icon-btn" aria-label={t('Umanji')} title={`${t('Umanji')} (${mod}+−)`} onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" /></button>
        <button type="button" className="pct" aria-label={t('Vrati zum na 100 %')} title={`100 % (${mod}+0)`} onClick={zoomReset}>{Math.round(zoom * 100)} %</button>
        <button type="button" className="icon-btn" aria-label={t('Uvećaj')} title={`${t('Uvećaj')} (${mod}+=)`} onClick={() => zoomBy(1.25)}><Icon name="plus" /></button>
        <button type="button" className="icon-btn" aria-label={t('Prikaži sve')} title={`${t('Prikaži sve')} (Shift+1)`} onClick={() => fitView()}><Icon name="fit" /></button>
      </div>
      <UndoGroup />
    </div>
  )
}

function UndoGroup() {
  const pastLen = useStoreTemporal((t) => t.pastStates.length)
  const futureLen = useStoreTemporal((t) => t.futureStates.length)
  return (
    <div className="group">
      <button type="button" className="icon-btn" aria-label={t('Poništi')} title={`${t('Poništi')} (${mod}+Z)`} disabled={!pastLen} onClick={undo}><Icon name="undo" /></button>
      <button type="button" className="icon-btn" aria-label={t('Ponovi')} title={`${t('Ponovi')} (${mod}+Shift+Z)`} disabled={!futureLen} onClick={redo}><Icon name="redo" /></button>
    </div>
  )
}

type PlanSlice = { shapes: Shape[]; settings: Settings }
function useStoreTemporal<T>(sel: (s: TemporalState<PlanSlice>) => T) {
  return useZustand(useStore.temporal, sel)
}

// ---------- top-right: materials ----------
export function Materials() {
  const shapes = useStore((s) => s.shapes)
  const settings = useStore((s) => s.settings)
  const joins = useStore((s) => s.joins)
  const select = useStore((s) => s.select)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const tot = useMemo(() => totals(shapes, settings, joins), [shapes, settings, joins])
  const items = useMemo(() => planItems(shapes, joins, settings), [shapes, joins, settings])
  if (!shapes.length) return null
  const list = [
    t('Rubnjak 100 cm: {n} kom ({base} + 5 % rezerve)', { n: Math.ceil(tot.buyL * 1.05), base: tot.buyL }),
    tot.buyS ? t('Rubnjak 33 cm: {n} kom ({base} + 5 % rezerve)', { n: Math.ceil(tot.buyS * 1.05), base: tot.buyS }) : '',
    t('Ukupno {len} m rubnjaka, oko {weight} t, {cost} € bez rezerve', { len: f1(tot.len / 100), weight: f1(tot.weight / 1000), cost: f2(tot.cost) }),
  ].filter(Boolean).join('\n')
  return (
    <div className={`materials ${open ? 'open' : ''}`}>
      <button type="button" className="materials-pill" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{tot.buyL}{tot.buyS ? ` + ${tot.buyS}` : ''}</b> {t('kom')} · <b>{f1(tot.len / 100)} m</b> · <b>{f2(tot.cost)} €</b>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>
      {open && (
        <div className="panel materials-panel">
          <h2>{t('Cijelo dvorište')}</h2>
          <div className="stats">
            <div className="stat"><b>{tot.buyL}{tot.buyS ? ` + ${tot.buyS}` : ''}</b><span>{t(tot.buyS ? 'kom. 100 + 33 cm' : 'kom. 100 cm')}{tot.halving ? ', ' + t('{n} na pola', { n: tot.halving }) : ''}</span></div>
            <div className="stat"><b>{f2(tot.cost)} €</b><span>{t('bez rezerve')}</span></div>
            <div className="stat"><b>{f1(tot.len / 100)} m</b><span>{t('rubnjaka')}</span></div>
            <div className="stat"><b>{tot.cuts}</b><span>{t('rezova')} · {f1(tot.weight / 1000)} t</span></div>
          </div>
          <table>
            <thead><tr><th>{t('Oblik')}</th><th>{t('Rubnjak')}</th><th>{t('Cijena')}</th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => { select(s.first); fitView(s.first) }}>
                  <td><i className={`swatch fill-${s.kind}`} />{s.name}</td>
                  <td className="n">{f1(s.lay.length / 100)} m</td>
                  <td className="n">{f2(s.lay.cost)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{t('Popis za kupnju')}</h3>
          <pre className="shopping">{list}</pre>
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(list); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard refused */ }
          }}>{t(copied ? 'Kopirano' : 'Kopiraj popis')}</button>
        </div>
      )}
    </div>
  )
}

// ---------- left: properties of the selected shape ----------
export function Inspector() {
  const selected = useStore((s) => s.selected)
  const sh = useStore((s) => s.shapes.find((x) => x.id === s.selected))
  const settings = useStore((s) => s.settings)
  const panelOpen = useStore((s) => s.panelOpen)
  const selection = useStore((s) => s.selection)
  const join = useStore((s) => (s.selected ? joinOf(s.joins, s.selected) : undefined))
  const shapesAll = useStore((s) => s.shapes)
  const st = useStore.getState()
  const [armed, setArmed] = useState(false)
  if (selection.length > 1) return <MultiInspector ids={selection} />
  if (!sh || !selected) return null
  const jl = join ? joinLayout(join, shapesAll, settings) : null
  const lay: Layout = jl && !jl.error ? jl : layout(sh, settings)
  return (
    <aside className={`panel inspector ${panelOpen ? 'expanded' : ''}`} aria-label={t('Svojstva oblika')}>
      <button type="button" className="sheet-handle" aria-label={t(panelOpen ? 'Smanji panel' : 'Proširi panel')} onClick={() => st.set({ panelOpen: !panelOpen })}><span /></button>
      <div className="inspector-head">
        <h2><i className={`swatch fill-${sh.kind}`} />{sh.name}{join && <small className="in-join">{t('u spoju „{name}”', { name: join.name })}</small>}</h2>
        <button type="button" className="icon-btn" aria-label={t('Zatvori')} title={`${t('Zatvori')} (Esc)`} onClick={() => st.select(null)}><Icon name="close" /></button>
      </div>
      <div className="inspector-summary">
        <b>{lay.buyS ? `${lay.buyL} + ${lay.buyS}` : lay.buyL}</b> {t('kom')} · <b>{f1(lay.length / 100)} m</b> · <b>{f2(lay.cost)} €</b>
      </div>
      <div className="inspector-body">
        <ShapeForm idPrefix="i" sh={sh} settings={settings} onChange={(p) => st.updateShape(sh.id, p)} inJoin={!!join} />
        {join && <JoinSection join={join} lay={jl} />}
        <fieldset>
          <legend>{t('Položaj')}</legend>
          <div className="pair">
            <NumField id="i-x" label="X cm" digits={1} value={sh.x} onChange={(v) => st.moveShape(sh.id, v, sh.y)} allowNegative />
            <NumField id="i-y" label="Y cm" digits={1} value={sh.y} onChange={(v) => st.moveShape(sh.id, sh.x, v)} allowNegative />
          </div>
          <div className="row">
            <button type="button" title={t('Rotiraj ulijevo (Shift+R)')} onClick={() => st.updateShape(sh.id, { rot: ((sh.rot - 90) % 360 + 360) % 360 })}><Icon name="rotate-left" /> 90°</button>
            <button type="button" title={t('Rotiraj udesno (R)')} onClick={() => st.updateShape(sh.id, { rot: (sh.rot + 90) % 360 })}><Icon name="rotate-right" /> 90°</button>
            <label className="num grow" htmlFor="i-rot"><span>°</span>
              <input id="i-rot" inputMode="decimal" value={sh.rot} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) st.updateShape(sh.id, { rot: v }) }} />
            </label>
          </div>
        </fieldset>
        <Distance id={sh.id} />
        {join && <h3>{t('Rubnjaci za cijeli spoj')}</h3>}
        <Results lay={lay} settings={settings} />
        <div className="row">
          <button type="button" title={`${t('Dupliciraj')} (${mod}+D)`} onClick={() => st.duplicateShape(sh.id)}><Icon name="copy" /> {t('Dupliciraj')}</button>
          <button type="button" className="danger" title={`${t('Obriši')} (Delete)`} onClick={() => { if (armed) { st.removeShape(sh.id); setArmed(false) } else setArmed(true) }} onBlur={() => setArmed(false)}>
            <Icon name="trash" /> {t(armed ? 'Sigurno obriši?' : 'Obriši')}
          </button>
        </div>
      </div>
    </aside>
  )
}

// ---------- dialogs ----------
export function Builder() {
  const open = useStore((s) => s.builderOpen)
  const settings = useStore((s) => s.settings)
  if (!open) return null
  return <BuilderBody settings={settings} />
}

function BuilderBody({ settings }: { settings: Settings }) {
  const st = useStore.getState()
  const [draft, setDraft] = useState<Shape>(() => ({
    id: newId(), name: t('Oblik {n}', { n: st.shapes.length + 1 }), kind: 'asfalt', wpx: 200, hpx: 120,
    r: { tl: 0, tr: 0, br: 0, bl: 0 }, sides: { t: true, r: true, b: true, l: true }, mode: 'mix', x: 0, y: 0, rot: 0,
  }))
  const lay = layout(draft, settings)
  const close = () => st.set({ builderOpen: false })
  const add = () => {
    // drop it in the middle of the current view
    const { w, h } = canvasSize(), v = useStore.getState().view
    const x = Math.round((v.x + w / 2 / v.zoom - lay.W / 2) / 10) * 10, y = Math.round((v.y + h / 2 / v.zoom - lay.H / 2) / 10) * 10
    useStore.getState().addShape({ ...draft, x, y })
    close()
  }
  return (
    <div className="overlay" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className="dialog builder" role="dialog" aria-modal="true" aria-labelledby="b-title">
        <div className="builder-preview">
          <ShapePreview sh={draft} settings={settings} />
          <Results lay={lay} settings={settings} />
        </div>
        <div className="builder-form">
          <div className="inspector-head"><h2 id="b-title">{t('Novi oblik')}</h2>
            <button type="button" className="icon-btn" aria-label={t('Zatvori')} onClick={close}><Icon name="close" /></button></div>
          <label className="import-svg">
            <input type="file" accept="image/svg+xml,.svg" onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const msg = await importSvgFile(f)
              useStore.getState().set({ toast: msg, builderOpen: false })
              requestAnimationFrame(() => fitView())
            }} />
            <span>{t('Nepravilan oblik?')} <b>{t('Uvezi SVG iz Photoshopa')}</b></span>
          </label>
          <ShapeForm idPrefix="b" sh={draft} settings={settings} onChange={(p) => setDraft({ ...draft, ...p })} />
          <div className="row sticky-actions">
            <button type="button" className="primary" onClick={add}>{t('Dodaj na plan')}</button>
            <button type="button" onClick={close}>{t('Odustani')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const lang = useStore((s) => s.lang)
  if (!open) return null
  const st = useStore.getState()
  const close = () => st.set({ settingsOpen: false })
  const field = (key: keyof Settings, label: string) => (
    <label className="num" htmlFor={'set-' + key}><span>{label}</span>
      <input id={'set-' + key} inputMode="decimal" defaultValue={settings[key]}
        onChange={(e) => { const v = parseFloat(e.target.value.replace(',', '.')); if (Number.isFinite(v) && v > 0) st.setSettings({ [key]: v }) }} />
    </label>
  )
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      <div className="dialog small" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <div className="inspector-head"><h2 id="set-title">{t('Postavke i cijene')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Zatvori')} onClick={close}><Icon name="close" /></button></div>
        <fieldset><legend>{t('Mjerilo crteža')}</legend>
          <div className="pair">{field('spx', 'px')}{field('scm', 'cm')}</div>
          <p className="hint">1 px = {f1(settings.scm / settings.spx)} cm</p>
        </fieldset>
        <fieldset><legend>{t('Ugradnja')}</legend>{field('gap', t('Fuga (cm)'))}</fieldset>
        <fieldset><legend>{t('Cijene po komadu (€)')}</legend>
          <div className="pair">{field('pL', '100 cm')}{field('pS', '33 cm')}</div>
        </fieldset>
        <fieldset><legend>{t('Jezik')}</legend>
          <div className="seg" role="radiogroup" aria-label={t('Jezik')}>
            {(['en', 'hr'] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </fieldset>
        <div className="row"><button type="button" className="primary" onClick={close}>{t('Gotovo')}</button></div>
      </div>
    </div>
  )
}

const shortcuts = (): [string, string][] => [
  ['V', t('Odabir')], ['M', t('Ravnalo: klik-klik ili povuci (Shift: 45°, Alt: bez lijepljenja)')], ['K', t('Nož: crta preko cijelog oblika ga prereže')], [t('H ili razmaknica + povlačenje'), t('Pomicanje pogleda')], ['N', t('Novi oblik')],
  [`${mod}+Z`, t('Poništi')], [`${mod}+Shift+Z`, t('Ponovi')], [`${mod}+D`, t('Dupliciraj')], ['Delete', t('Obriši')],
  [t('Strelice'), t('Pomakni 1 cm (Shift: 10 cm)')], ['R / Shift+R', t('Rotiraj 90° udesno / ulijevo')],
  [t('{mod}+kotačić ili štipanje', { mod }), t('Zum')], [t('Kotačić'), t('Pomicanje pogleda')], [`${mod}+= / ${mod}+−`, t('Uvećaj / umanji')],
  [`${mod}+0`, t('Zum 100 %')], ['Shift+1', t('Prikaži sve')], ['Shift+2', t('Prikaži odabrani')], [`${mod}+'`, t('Poravnanje na 10 cm')],
  [t('Alt + povlačenje'), t('Pomicanje bez poravnanja')], ['Esc', t('Odznači / zatvori')], ['?', t('Prečaci')],
]
export function HelpDialog() {
  const open = useStore((s) => s.helpOpen)
  if (!open) return null
  const close = () => useStore.getState().set({ helpOpen: false })
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="dialog small" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="inspector-head"><h2 id="help-title">{t('Prečaci')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Zatvori')} onClick={close}><Icon name="close" /></button></div>
        <table className="shortcuts"><tbody>{shortcuts().map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
        <p className="hint">{t('Na mobitelu: dva prsta za zum i pomicanje, dodir za odabir.')}</p>
      </div>
    </div>
  )
}

export function EmptyState() {
  const n = useStore((s) => s.shapes.length)
  const loaded = useStore((s) => s.loaded)
  if (n) return null
  return (
    <div className="empty">
      {loaded ? (
        <>
          <h2>{t('Plan je prazan')}</h2>
          <p>{t('Dodaj prvi dio dvorišta: upiši mjere s crteža, označi gdje idu rubnjaci, pa ga postavi na plan.')}</p>
          <button type="button" className="primary" onClick={() => useStore.getState().set({ builderOpen: true })}><Icon name="plus" /> {t('Novi oblik')}</button>
        </>
      ) : <p>{t('Učitavam plan…')}</p>}
    </div>
  )
}

// Distance to another shape: pick it here (or Alt+click it on the canvas) and type the gap
function Distance({ id }: { id: string }) {
  const shapes = useStore((s) => s.shapes)
  const target = useStore((s) => s.measureTo)
  useStore((s) => s.settings)
  const others = shapes.filter((s) => s.id !== id)
  if (!others.length) return null
  const boxes = target ? boxesFor(id, target) : null
  const g = boxes ? gaps(boxes.a, boxes.b) : null
  return (
    <fieldset>
      <legend>{t('Udaljenost')}</legend>
      <label className="field" htmlFor="i-measure">
        <span>{t('Do oblika')}</span>
        <select id="i-measure" value={target ?? ''} onChange={(e) => useStore.getState().set({ measureTo: e.target.value || null })}>
          <option value="">{t('Odaberi…')}</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {g && (
        <div className="pair">
          {g.gx ? <NumField id="i-gx" label="↔ cm" digits={1} value={g.gx.gap} onChange={(v) => setGap(id, target!, 'x', v)} /> : <p className="hint">↔ {t('preklapaju se')}</p>}
          {g.gy ? <NumField id="i-gy" label="↕ cm" digits={1} value={g.gy.gap} onChange={(v) => setGap(id, target!, 'y', v)} /> : <p className="hint">↕ {t('preklapaju se')}</p>}
        </div>
      )}
      <p className="hint">{t('Mjeri se od vanjskog ruba, s rubnjakom. Na platnu: drži {alt} i prijeđi mišem preko drugog oblika, {alt}+klik ga zadrži, a klik na broj ga mijenja. Upisom se pomiče odabrani oblik.', { alt: isMac ? '⌥' : 'Alt' })}</p>
    </fieldset>
  )
}

export function Toast() {
  const msg = useStore((s) => s.toast)
  useEffect(() => {
    if (!msg) return
    const timer = setTimeout(() => useStore.getState().set({ toast: null }), 7000)
    return () => clearTimeout(timer)
  }, [msg])
  if (!msg) return null
  return (
    <div className="toast" role="status">
      <span>{msg}</span>
      <button type="button" className="icon-btn" aria-label={t('Zatvori')} onClick={() => useStore.getState().set({ toast: null })}><Icon name="close" /></button>
    </div>
  )
}

export function PasteDialog() {
  const open = useStore((s) => s.pasteOpen)
  const [text, setText] = useState('')
  if (!open) return null
  const close = () => { setText(''); useStore.getState().set({ pasteOpen: false }) }
  const run = () => {
    const r = importSvgText(text, t('Zalijepljeno'))
    useStore.getState().set({ toast: r.message })
    if (r.ok) { close(); requestAnimationFrame(() => fitView()) }
  }
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      <div className="dialog small" role="dialog" aria-modal="true" aria-labelledby="paste-title">
        <div className="inspector-head"><h2 id="paste-title">{t('Zalijepi SVG kod')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Zatvori')} onClick={close}><Icon name="close" /></button></div>
        <p className="hint">{t('U Photoshopu desni klik na sloj → Copy SVG, pa zalijepi ovdje. Na računalu možeš i samo pritisnuti {key} na platnu.', { key: `${mod}+V` })}</p>
        <textarea id="paste-svg" className="paste-area" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="<svg …>…</svg>" spellCheck={false} />
        <div className="row"><button type="button" className="primary" disabled={!text.trim()} onClick={run}>{t('Uvezi')}</button><button type="button" onClick={close}>{t('Odustani')}</button></div>
      </div>
    </div>
  )
}

// Several shapes selected: join them, or tidy up
function MultiInspector({ ids }: { ids: string[] }) {
  const shapes = useStore((s) => s.shapes)
  const joins = useStore((s) => s.joins)
  const st = useStore.getState()
  const list = shapes.filter((s) => ids.includes(s.id))
  const already = joins.find((j) => ids.every((id) => j.members.includes(id)) && j.members.length === ids.length)
  return (
    <aside className="panel inspector" aria-label={t('Odabrani oblici')}>
      <div className="inspector-head">
        <h2>{t('Odabrano: {n}', { n: list.length })}</h2>
        <button type="button" className="icon-btn" aria-label={t('Zatvori')} title={`${t('Zatvori')} (Esc)`} onClick={() => st.select(null)}><Icon name="close" /></button>
      </div>
      <ul className="sel-list">{list.map((s) => <li key={s.id}><i className={`swatch fill-${s.kind}`} />{s.name}</li>)}</ul>
      {already
        ? <p className="hint">{t('Ovi oblici su već spojeni ({name}).', { name: already.name })}</p>
        : <>
          <button type="button" className="primary" onClick={() => { st.joinShapes(ids); st.set({ toast: t('Spojeno. Rubnjaci sad idu samo vanjskim rubom spoja.') }) }}>
            {t('Spoji u jedan obris')}
          </button>
          <p className="hint">{t('Rubnjaci idu samo vanjskim rubom, a gdje se oblici dodiruju nema rubnjaka. Oblici se moraju dodirivati ili preklapati; kad ih povlačiš, rubovi se sami zalijepe.')}</p>
        </>}
      <p className="hint">{t('Shift + klik dodaje ili makne oblik iz odabira. Povlačenjem pomičeš sve odabrane.')}</p>
    </aside>
  )
}

function JoinSection({ join, lay }: { join: Join; lay: JoinLayout | null }) {
  const st = useStore.getState()
  return (
    <fieldset className="join-box">
      <legend>{t('Dio spoja')}</legend>
      <NameField key={join.id} id="j-name" label={t('Naziv cijelog spoja')} value={join.name} onCommit={(name) => st.updateJoin(join.id, { name })} />
      {lay?.error && <p className="warn">{lay.error}</p>}
      {lay && !lay.error && (
        <>
          <div className="edge-list">
            {lay.edges.map((e, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={e.curbed} onChange={() => {
                  const curbs = lay.edges.map((x) => x.curbed); curbs[i] = !curbs[i]
                  st.updateJoin(join.id, { edgeCurbs: curbs })
                }} />
                <span className={`edge-num ${e.curbed ? 'on' : ''}`}>{i + 1}</span>
              </label>
            ))}
          </div>
          <p className="hint">{t('Rubove spoja uključuješ i klikom na platnu. Brojevi se mogu promijeniti kad promijeniš oblik.')}</p>
        </>
      )}
      <label className="field" htmlFor="j-mode"><span>{t('Rubnjaci')}</span>
        <select id="j-mode" value={join.mode} onChange={(e) => st.updateJoin(join.id, { mode: e.target.value as Join['mode'] })}>
          {(Object.keys(MODES) as Join['mode'][]).map((m) => <option key={m} value={m}>{t(MODES[m])}</option>)}
        </select></label>
      <div className="row">
        <button type="button" onClick={() => { st.splitJoin(join.id); st.set({ toast: t('Spoj razdvojen. Svaki oblik opet ima svoje rubnjake.') }) }}>{t('Razdvoji spoj')}</button>
        <span className="hint">{t('{n} oblika', { n: join.members.length })}</span>
      </div>
    </fieldset>
  )
}
