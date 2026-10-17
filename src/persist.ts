import { pauseHistory, resumeHistory, useStore } from './store'
import { DEFAULT_SETTINGS, type Plan, type Shape } from './types'

const CACHE = 'dvoriste-plan'

function normalize(raw: any): Plan {
  const shapes: Shape[] = (raw?.shapes ?? []).map((s: any) => ({
    kind: /trav/i.test(s.name ?? '') ? 'trava' : 'asfalt',
    mode: 'mix',
    rot: 0,
    ...s,
  }))
  return { version: 1, settings: { ...DEFAULT_SETTINGS, ...raw?.settings }, shapes, rulers: raw?.rulers ?? [], joins: raw?.joins ?? [] }
}

let rev = 0 // revision of the plan this window last loaded or saved
let applyingRemote = false

export async function loadPlan() {
  let plan: Plan | null = null
  try {
    const r = await fetch('/api/plan')
    if (r.ok) { const j = await r.json(); if (j) { plan = normalize(j); rev = j.rev ?? 0 } }
  } catch { /* server unreachable: fall back to the browser copy */ }
  if (!plan) {
    try { const c = localStorage.getItem(CACHE); if (c) plan = normalize(JSON.parse(c)) } catch { /* ignore */ }
    if (plan) useStore.getState().set({ saveState: 'offline' })
  }
  useStore.getState().load(plan ?? normalize(null))
  useStore.temporal.getState().clear()
}

let timer: ReturnType<typeof setTimeout> | undefined
let inflight = Promise.resolve()

// Replace the plan with the server's copy, keeping what this window is looking at
function applyRemote(raw: any) {
  const p = normalize(raw), st = useStore.getState()
  applyingRemote = true
  pauseHistory() // another window's change is not something to undo here
  useStore.setState({
    shapes: p.shapes, settings: p.settings, rulers: p.rulers ?? [], joins: p.joins ?? [],
    selected: p.shapes.some((s) => s.id === st.selected) ? st.selected : null,
    selection: st.selection.filter((id) => p.shapes.some((s) => s.id === id)),
  })
  resumeHistory()
  applyingRemote = false
  rev = raw?.rev ?? rev
}

export function startAutosave() {
  // pick up saves from other windows while this one has nothing waiting to be saved
  setInterval(async () => {
    if (timer || useStore.getState().saveState === 'saving' || document.hidden) return
    try {
      const r = await (await fetch('/api/plan/rev')).json()
      if (r.rev > rev) applyRemote(await (await fetch('/api/plan')).json())
    } catch { /* offline: try again on the next tick */ }
  }, 2500)
  useStore.subscribe((s, prev) => {
    if (applyingRemote || !s.loaded || (s.shapes === prev.shapes && s.settings === prev.settings && s.rulers === prev.rulers && s.joins === prev.joins)) return
    clearTimeout(timer)
    useStore.getState().set({ saveState: 'saving' })
    timer = setTimeout(() => {
      timer = undefined
      inflight = inflight.then(async () => {
        const { shapes, settings, rulers, joins } = useStore.getState()
        const plan = { version: 1, settings, shapes, rulers, joins }
        try { localStorage.setItem(CACHE, JSON.stringify(plan)) } catch { /* ignore */ }
        try {
          const r = await fetch('/api/plan', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...plan, baseRev: rev }) })
          if (r.status === 409) {
            applyRemote(await r.json())
            useStore.getState().set({ saveState: 'saved', toast: 'Plan je u međuvremenu promijenjen u drugom prozoru ili na drugom uređaju. Učitana je najnovija verzija, pa zadnju izmjenu ponovi.' })
            return
          }
          if (r.ok) rev = (await r.json()).rev
          useStore.getState().set({ saveState: r.ok ? 'saved' : 'error' })
        } catch {
          useStore.getState().set({ saveState: 'offline' })
        }
      })
    }, 500)
  })
}

export function exportJSON() {
  const { shapes, settings, rulers, joins } = useStore.getState()
  const blob = new Blob([JSON.stringify({ version: 1, settings, shapes, rulers, joins }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `dvoriste-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importJSON(file: File) {
  const plan = normalize(JSON.parse(await file.text()))
  const st = useStore.getState()
  useStore.setState({ shapes: plan.shapes, settings: plan.settings, rulers: plan.rulers ?? [], joins: plan.joins ?? [], selected: null, selection: [] })
  st.set({ saveState: 'saving' })
}
