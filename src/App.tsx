import { useEffect, useRef, useState } from 'react'
import { Canvas } from './components/Canvas'
import { Icon } from './components/Icon'
import { MeasureLabels } from './components/Measure'
import { RulerLabels } from './components/Ruler'
import { PrintView } from './components/PrintView'
import {
  Builder, EmptyState, fitView, HelpDialog, PasteDialog, Toast, Inspector, MainMenu, Materials, SettingsDialog, Toolbar, ZoomBar, zoomBy, zoomReset,
} from './components/Panels'
import { loadPlan, startAutosave } from './persist'
import { importSvgText } from './importSvg'
import { redo, undo, useStore } from './store'
import { t } from './i18n'

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function App() {
  const [spaceDown, setSpaceDown] = useState(false)
  const lang = useStore((s) => s.lang)
  const started = useRef(false)

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  useEffect(() => {
    if (started.current) return
    started.current = true
    loadPlan().then(() => { startAutosave(); requestAnimationFrame(() => fitView()) })
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const dialog = st.builderOpen || st.helpOpen || st.settingsOpen || st.pasteOpen || st.printOpen
      if (e.key === 'Escape') {
        if (st.helpOpen || st.settingsOpen || st.printOpen) st.set({ helpOpen: false, settingsOpen: false, printOpen: false })
        else if (st.builderOpen) return
        else if (st.rulerDraft) st.set({ rulerDraft: null })
        else if (st.tool === 'ruler' || st.tool === 'cut') st.set({ tool: 'select', snapHint: null })
        else if (st.measureTo) st.set({ measureTo: null })
        else st.select(null)
        return
      }
      if (typing(e.target) || dialog) return
      const cmd = e.metaKey || e.ctrlKey, sel = st.selected
      const key = e.key.toLowerCase()
      if (e.code === 'Space') { if (!e.repeat) setSpaceDown(true); e.preventDefault(); return }
      if (cmd && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (cmd && key === 'y') { e.preventDefault(); redo(); return }
      if (cmd && key === 'p') { e.preventDefault(); st.set({ printOpen: true }); return }
      if (cmd && key === 'd') { e.preventDefault(); if (sel) st.duplicateShape(sel); return }
      if (cmd && (key === '=' || key === '+')) { e.preventDefault(); zoomBy(1.25); return }
      if (cmd && key === '-') { e.preventDefault(); zoomBy(1 / 1.25); return }
      if (cmd && key === '0') { e.preventDefault(); zoomReset(); return }
      if (cmd && e.key === "'") { e.preventDefault(); st.set({ snap: !st.snap }); return }
      if (cmd) return
      if (e.shiftKey && e.code === 'Digit1') { fitView(); return }
      if (e.shiftKey && e.code === 'Digit2') { if (sel) fitView(sel); return }
      if (e.key === '?') { st.set({ helpOpen: true }); return }
      if (key === 'v') st.set({ tool: 'select' })
      else if (key === 'h') st.set({ tool: 'hand' })
      else if (key === 'm') st.set({ tool: 'ruler' })
      else if (key === 'k') st.set({ tool: 'cut' })
      else if (key === 'n') { e.preventDefault(); st.set({ builderOpen: true }) }
      else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); st.removeShape(sel) }
      else if (sel && key === 'r') {
        const sh = st.shapes.find((s) => s.id === sel)!
        st.updateShape(sel, { rot: (((sh.rot + (e.shiftKey ? -90 : 90)) % 360) + 360) % 360 })
      } else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1, sh = st.shapes.find((s) => s.id === sel)!
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        st.moveShape(sel, sh.x + dx, sh.y + dy)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
      if (e.key === 'Alt' && useStore.getState().measureHover) useStore.getState().set({ measureHover: null })
    }
    const blur = () => { setSpaceDown(false); useStore.getState().set({ measureHover: null }) }
    // pasting SVG code anywhere outside a text field imports it (Photoshop: right click layer → Copy SVG)
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!/<svg[\s>]/i.test(text)) return
      e.preventDefault()
      useStore.getState().set({ toast: importSvgText(text.slice(text.search(/<svg[\s>]/i)), t('Zalijepljeno')).message, builderOpen: false })
      requestAnimationFrame(() => fitView())
    }
    window.addEventListener('paste', paste)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('paste', paste); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  return (
    // keyed by language so memoised layouts and their labels are rebuilt on a switch
    <div className="app" key={lang}>
      <Canvas spaceDown={spaceDown} />
      <MeasureLabels />
      <RulerLabels />
      <EmptyState />
      <header className="top">
        <MainMenu />
        <Toolbar />
        <Materials />
      </header>
      <Inspector />
      <ZoomBar />
      <button type="button" className="icon-btn help-btn" aria-label={t('Prečaci')} title={`${t('Prečaci')} (?)`} onClick={() => useStore.getState().set({ helpOpen: true })}><Icon name="help" /></button>
      <Builder />
      <SettingsDialog />
      <HelpDialog />
      <PasteDialog />
      <PrintView />
      <Toast />
    </div>
  )
}
