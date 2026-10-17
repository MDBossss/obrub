import { create } from 'zustand'
import { temporal } from 'zundo'
import { DEFAULT_SETTINGS, type Join, type Plan, type Ruler, type Settings, type Shape } from './types'

export type Tool = 'select' | 'hand' | 'ruler' | 'cut'
export interface View { x: number; y: number; zoom: number } // zoom = screen px per cm

interface State {
  shapes: Shape[]
  rulers: Ruler[]
  joins: Join[]
  selection: string[] // all selected shapes; `selected` is the one the panel edits
  settings: Settings
  selected: string | null
  tool: Tool
  view: View
  snap: boolean
  loaded: boolean
  saveState: 'saved' | 'saving' | 'error' | 'offline'
  builderOpen: boolean
  helpOpen: boolean
  settingsOpen: boolean
  panelOpen: boolean // mobile bottom sheet
  measureTo: string | null // pinned distance target for the selected shape
  measureHover: string | null // shape under the cursor while Alt is held
  toast: string | null
  rulerDraft: { a: [number, number]; b: [number, number] } | null
  snapHint: { p: [number, number]; kind: 'point' | 'edge' } | null
  pasteOpen: boolean
  printOpen: boolean
  load: (p: Plan) => void
  addShape: (s: Shape) => void
  addRuler: (r: Ruler) => void
  toggleSelect: (id: string) => void
  moveShapes: (moves: { id: string; x: number; y: number }[]) => void
  joinShapes: (ids: string[]) => void
  updateJoin: (id: string, patch: Partial<Join>) => void
  splitJoin: (id: string) => void
  removeRuler: (id: string | null) => void // null clears all
  updateShape: (id: string, patch: Partial<Shape>) => void
  moveShape: (id: string, x: number, y: number) => void
  removeShape: (id: string) => void
  duplicateShape: (id: string) => void
  setSettings: (patch: Partial<Settings>) => void
  select: (id: string | null) => void
  set: (patch: Partial<Pick<State, 'tool' | 'view' | 'snap' | 'saveState' | 'builderOpen' | 'helpOpen' | 'settingsOpen' | 'panelOpen' | 'measureTo' | 'measureHover' | 'toast' | 'pasteOpen' | 'printOpen' | 'rulerDraft' | 'snapHint'>>) => void
}

export const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      shapes: [],
      rulers: [],
      joins: [],
      selection: [],
      settings: DEFAULT_SETTINGS,
      selected: null,
      tool: 'select',
      view: { x: -300, y: -200, zoom: 0.4 },
      snap: true,
      loaded: false,
      saveState: 'saved',
      builderOpen: false,
      helpOpen: false,
      settingsOpen: false,
      panelOpen: false,
      measureTo: null,
      measureHover: null,
      toast: null,
      rulerDraft: null,
      snapHint: null,
      pasteOpen: false,
      printOpen: false,
      load: (p) => set({ shapes: p.shapes, rulers: p.rulers ?? [], joins: p.joins ?? [], settings: { ...DEFAULT_SETTINGS, ...p.settings }, loaded: true }),
      toggleSelect: (id) => {
        const sel = get().selection.includes(id) ? get().selection.filter((x) => x !== id) : [...get().selection, id]
        set({ selection: sel, selected: sel.length ? sel[sel.length - 1] : null, measureTo: null })
      },
      moveShapes: (moves) => set({ shapes: get().shapes.map((s) => { const m = moves.find((x) => x.id === s.id); return m ? { ...s, x: m.x, y: m.y } : s }) }),
      joinShapes: (ids) => {
        // a shape belongs to at most one join: merging takes over any joins they were already in
        const old = get().joins.filter((j) => j.members.some((m) => ids.includes(m)))
        const members = [...new Set([...ids, ...old.flatMap((j) => j.members)])]
        const j: Join = { id: newId(), name: `Spoj ${get().joins.length + 1}`, members, mode: old[0]?.mode ?? get().shapes.find((s) => s.id === ids[0])?.mode ?? 'mix' }
        set({ joins: [...get().joins.filter((x) => !old.includes(x)), j] })
      },
      updateJoin: (id, patch) => set({ joins: get().joins.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
      splitJoin: (id) => set({ joins: get().joins.filter((j) => j.id !== id) }),
      addRuler: (r) => set({ rulers: [...get().rulers, r] }),
      removeRuler: (id) => set({ rulers: id ? get().rulers.filter((r) => r.id !== id) : [] }),
      addShape: (s) => set({ shapes: [...get().shapes, s], selected: s.id, selection: [s.id] }),
      updateShape: (id, patch) => set({ shapes: get().shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      moveShape: (id, x, y) => set({ shapes: get().shapes.map((s) => (s.id === id ? { ...s, x, y } : s)) }),
      removeShape: (id) => set({
        shapes: get().shapes.filter((s) => s.id !== id),
        joins: get().joins.map((j) => ({ ...j, members: j.members.filter((m) => m !== id) })).filter((j) => j.members.length > 1),
        selection: get().selection.filter((x) => x !== id),
        selected: get().selected === id ? null : get().selected,
        measureTo: get().measureTo === id || get().selected === id ? null : get().measureTo,
      }),
      duplicateShape: (id) => {
        const s = get().shapes.find((x) => x.id === id)
        if (!s) return
        const c: Shape = { ...structuredClone(s), id: newId(), name: s.name + ' (kopija)', x: s.x + 100, y: s.y + 100 }
        set({ shapes: [...get().shapes, c], selected: c.id, selection: [c.id] })
      },
      setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      select: (id) => set(id === get().selected && get().selection.length <= 1 ? {} : { selected: id, selection: id ? [id] : [], measureTo: null, measureHover: null }),
      set: (patch) => set(patch),
    }),
    {
      // only the plan is undoable; view, selection and UI flags are not
      partialize: (s) => ({ shapes: s.shapes, settings: s.settings, rulers: s.rulers, joins: s.joins }),
      equality: (a, b) => a.shapes === b.shapes && a.settings === b.settings && a.rulers === b.rulers && a.joins === b.joins,
      limit: 200,
    },
  ),
)

export const undo = () => useStore.temporal.getState().undo()
export const redo = () => useStore.temporal.getState().redo()
export const pauseHistory = () => useStore.temporal.getState().pause()
export const resumeHistory = () => useStore.temporal.getState().resume()
