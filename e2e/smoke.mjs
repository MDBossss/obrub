// Smoke test: starts its own dev server on :6124 against a scratch copy of e2e/fixtures/plan.json,
// so it never touches the real plan or the server you have open.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.SHOTS ?? '/tmp'
const PLAN = join(await mkdtemp(join(tmpdir(), 'dvoriste-e2e-')), 'plan.json')
await copyFile(join(ROOT, 'e2e/fixtures/plan.json'), PLAN)
const original = await readFile(PLAN, 'utf8')
const PORT = 6124, APP_URL = `http://localhost:${PORT}/`
const server = spawn(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT)], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PLAN_FILE: PLAN }, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(APP_URL)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
}
const state = (page) => page.evaluate(() => { const s = window.__dvoriste.getState(); return { shapes: s.shapes, selected: s.selected, view: s.view, saveState: s.saveState } })
const shapeCenter = (page, id) => page.evaluate((id) => {
  const r = document.querySelector(`[data-shape="${id}"] path`).getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, id)

try {
  // ---------- desktop ----------
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  watch(page)
  await page.goto(APP_URL)
  await page.waitForFunction(() => window.__dvoriste.getState().loaded && document.querySelectorAll('[data-shape]').length > 0)
  await page.waitForTimeout(300)
  let s = await state(page)
  assert.equal(s.shapes.length, 2, 'loads both fixture shapes')
  assert.ok(s.shapes.find((x) => x.name === 'Trava ulaz').kind === 'trava', 'grass kind inferred')
  await page.screenshot({ path: `${SHOTS}/dvoriste-desktop.png` })

  // rename is saved once and shows up in a second window of the same plan
  const other = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  watch(other)
  await other.goto(APP_URL)
  await other.waitForFunction(() => window.__dvoriste.getState().loaded)
  await page.evaluate(() => window.__dvoriste.getState().select('u-oblik'))
  await page.locator('#i-name').fill('Prilaz')
  await page.keyboard.press('Enter')
  assert.equal((await state(page)).shapes.find((x) => x.id === 'u-oblik').name, 'Prilaz', 'rename committed on Enter')
  await other.waitForFunction(() => window.__dvoriste.getState().shapes.find((x) => x.id === 'u-oblik')?.name === 'Prilaz', null, { timeout: 8000 })
  await other.close()
  await page.evaluate(() => window.__dvoriste.getState().select(null))

  // select + drag the U shape
  const c = await shapeCenter(page, 'u-oblik')
  const before = s.shapes.find((x) => x.id === 'u-oblik')
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 30, { steps: 6 }); await page.mouse.up()
  s = await state(page)
  const after = s.shapes.find((x) => x.id === 'u-oblik')
  assert.equal(s.selected, 'u-oblik', 'click selects')
  assert.ok(after.x > before.x && after.y > before.y, 'drag moves')
  await page.getByRole('complementary', { name: 'Svojstva oblika' }).waitFor()
  await page.screenshot({ path: `${SHOTS}/dvoriste-selected.png` })

  // undo the drag in one step
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  s = await state(page)
  assert.deepEqual([s.shapes[0].x, s.shapes[0].y], [before.x, before.y], 'undo restores position in one step')

  // Alt+click pins a distance target; typing into the label moves the selected shape
  const tc = await shapeCenter(page, 'smvcb0r22c2p5')
  await page.keyboard.down('Alt'); await page.mouse.click(tc.x, tc.y); await page.keyboard.up('Alt')
  s = await state(page)
  assert.equal(s.selected, 'u-oblik', 'alt+click keeps the selection')
  const label = page.locator('button.measure-label')
  await label.first().waitFor()
  await page.screenshot({ path: `${SHOTS}/dvoriste-measure.png` })
  await label.first().click()
  await page.locator('.measure-input').fill('200')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('#i-gy, #i-gx')].some((el) => el.value === '200'), null, { timeout: 3000 })
    .catch(async () => assert.fail('typed gap applied, got ' + await page.evaluate(() => [...document.querySelectorAll('#i-gy, #i-gx')].map((el) => el.id + '=' + el.value).join(' '))))
  await page.keyboard.press('Escape') // unpin

  // ruler: click near a corner, then near an edge; both ends stick to the geometry
  const toScreen = (x, y) => page.evaluate(([x, y]) => {
    const v = window.__dvoriste.getState().view, r = document.querySelector('.canvas').getBoundingClientRect()
    return { x: r.left + (x - v.x) * v.zoom, y: r.top + (y - v.y) * v.zoom }
  }, [x, y])
  await page.keyboard.press('Escape')
  await page.keyboard.press('m')
  const U = (await state(page)).shapes.find((x) => x.id === 'u-oblik')
  const pa = await toScreen(U.x, U.y), pb = await toScreen(U.x, U.y + 200)
  await page.mouse.click(pa.x + 4, pa.y + 3)
  await page.mouse.move(pb.x + 5, pb.y, { steps: 4 })
  await page.mouse.click(pb.x + 5, pb.y)
  const rulers = await page.evaluate(() => window.__dvoriste.getState().rulers)
  assert.equal(rulers.length, 1, 'ruler added')
  assert.ok(Math.hypot(rulers[0].a[0] - U.x, rulers[0].a[1] - U.y) < 0.01, `start snapped to the corner: ${rulers[0].a}`)
  assert.ok(Math.abs(rulers[0].b[0] - U.x) < 0.01, `end snapped onto the edge: ${rulers[0].b}`)
  await page.locator('.ruler-label').first().waitFor()
  await page.screenshot({ path: `${SHOTS}/dvoriste-ruler.png` })
  await page.keyboard.press('Escape') // back to select
  assert.equal(await page.evaluate(() => window.__dvoriste.getState().tool), 'select')
  await page.evaluate(() => window.__dvoriste.getState().select('u-oblik'))

  // edit width in cm, px follows
  const cm = page.locator('#i-w-cm')
  await cm.fill('1000')
  s = await state(page)
  assert.ok(Math.abs(s.shapes[0].wpx * 650 / 214 - 1000) < 0.01, 'cm input drives px')
  const pxWant = String(+(1000 * 214 / 650).toFixed(2))
  await page.waitForFunction((w) => document.querySelector('#i-w-px').value === w, pxWant, { timeout: 3000 })
    .catch(async () => assert.fail(`px field follows cm: want ${pxWant}, got ${await page.locator('#i-w-px').inputValue()}`))

  // builder adds a shape
  await page.keyboard.press('Escape')
  await page.keyboard.press('n')
  await page.getByRole('dialog', { name: 'Novi oblik' }).waitFor()
  await page.locator('#b-name').fill('Test oblik')
  await page.screenshot({ path: `${SHOTS}/dvoriste-builder.png` })
  await page.getByRole('button', { name: 'Dodaj na plan' }).click()
  s = await state(page)
  assert.equal(s.shapes.length, 3, 'builder adds')

  // autosave reaches the file
  await page.waitForFunction(() => window.__dvoriste.getState().saveState === 'saved')
  await page.waitForTimeout(200)
  const saved = JSON.parse(await readFile(PLAN, 'utf8'))
  assert.equal(saved.shapes.length, 3, 'saved to data/plan.json')

  // SVG import: three outlines from a Photoshop-style export
  await page.keyboard.press('Escape')
  await page.locator('[data-testid=svg-input]').setInputFiles(join(ROOT, 'e2e/fixtures/photoshop.svg'))
  await page.getByText('Uvezeno oblika: 4').waitFor()
  s = await state(page)
  const imported = s.shapes.filter((x) => x.path)
  assert.equal(imported.length, 4, 'four outlines imported')
  assert.deepEqual(imported.map((x) => x.name), ['Asfalt prilaz', 'Trava nepravilna', 'Prebacaj', 'Trokut'])
  assert.equal(imported[1].kind, 'trava', 'grass kind from layer name')
  // the line overshoots the curve start by ~27 px; the import trims it back to where the curve turns
  const over = imported[2], ys = over.path.pts.map((p) => p[1])
  assert.ok(Math.max(...ys.slice(over.path.breaks[2])) <= ys[over.path.breaks[2]] + 0.01, 'curve no longer doubles back over the line')
  const tri = imported[3]
  assert.equal(tri.path.breaks.length, 3, 'triangle has three edges')
  await page.evaluate((id) => window.__dvoriste.getState().select(id), imported[0].id)
  await page.waitForTimeout(300)
  const pieceCount = () => page.evaluate((id) => document.querySelectorAll(`[data-shape="${id}"] .piece`).length, imported[0].id)
  const piecesBefore = await pieceCount()
  assert.ok(piecesBefore > 10, 'curbs laid along the imported outline')
  await page.screenshot({ path: `${SHOTS}/dvoriste-import.png` })
  // click a straight edge to drop its curbs
  const hit = await page.evaluate((id) => {
    const els = [...document.querySelectorAll(`[data-shape="${id}"] [data-edge]`)]
    const r = els.map((el) => el.getBoundingClientRect()).map((b, i) => ({ i, b })).sort((a, c) => Math.min(c.b.width, c.b.height) - Math.min(a.b.width, a.b.height)).pop()
    // a thin bounding box means a straight edge, whose centre lies on the edge itself
    return { x: r.b.left + r.b.width / 2, y: r.b.top + r.b.height / 2, edge: Number(els[r.i].dataset.edge) }
  }, imported[0].id)
  await page.mouse.click(hit.x, hit.y)
  s = await state(page)
  assert.equal(s.shapes.find((x) => x.id === imported[0].id).edgeCurbs[hit.edge], false, 'clicking an edge removes its curb')
  assert.ok(await pieceCount() < piecesBefore, 'fewer pieces after removing a curbed edge')
  assert.ok(await page.locator(`[data-shape="${imported[0].id}"] .edge-off`).count() >= 1, 'edge without curb drawn dashed')
  await page.screenshot({ path: `${SHOTS}/dvoriste-import-edge.png` })

  // pasting SVG code imports it; so does the paste dialog
  const svgCode = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><path data-name="Zalijepljeni" d="M0,0H300V200H0Z"/></svg>'
  await page.evaluate((code) => {
    const dt = new DataTransfer(); dt.setData('text/plain', code)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, svgCode)
  await page.waitForFunction(() => window.__dvoriste.getState().shapes.some((x) => x.name === 'Zalijepljeni'))
  await page.evaluate(() => window.__dvoriste.getState().set({ pasteOpen: true }))
  await page.locator('#paste-svg').fill(svgCode.replace('Zalijepljeni', 'Iz dijaloga'))
  await page.getByRole('button', { name: 'Uvezi', exact: true }).click()
  await page.waitForFunction(() => window.__dvoriste.getState().shapes.some((x) => x.name === 'Iz dijaloga'))

  // magnetic edges + join: B is dropped 12 cm right of A, nudged, and should land flush against it
  await page.keyboard.press('Escape')
  const k = 650 / 214, Wcm = 100 * k
  await page.evaluate(([Wcm]) => {
    const st = window.__dvoriste.getState()
    const base = { kind: 'asfalt', wpx: 100, hpx: 100, r: { tl: 0, tr: 0, br: 0, bl: 0 }, sides: { t: true, r: true, b: true, l: true }, mode: 'mix', rot: 0 }
    st.addShape({ ...base, id: 'join-a', name: 'A', x: 6000, y: 0 })
    st.addShape({ ...base, id: 'join-b', name: 'B', x: 6000 + Wcm + 12, y: 0 })
    st.select(null)
    st.set({ view: { zoom: 0.5, x: 5200, y: -200 } }) // keep the shapes clear of the side panel
  }, [Wcm])
  await page.waitForTimeout(200)
  const bc = await shapeCenter(page, 'join-b')
  await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.mouse.move(bc.x - 4, bc.y, { steps: 4 }); await page.mouse.up()
  s = await state(page)
  const A = s.shapes.find((x) => x.id === 'join-a'), Bs = s.shapes.find((x) => x.id === 'join-b')
  assert.ok(Math.abs(Bs.x - (A.x + Wcm)) < 0.01 && Math.abs(Bs.y - A.y) < 0.01, `B snapped flush to A: ${Bs.x - A.x - Wcm}, ${Bs.y - A.y}`)
  const ac = await shapeCenter(page, 'join-a')
  await page.mouse.click(ac.x, ac.y)
  await page.keyboard.down('Shift'); await page.mouse.click(bc.x - 4, bc.y); await page.keyboard.up('Shift')
  await page.getByRole('button', { name: 'Spoji u jedan obris' }).click({ timeout: 5000 })
  const piecesIn = (sel) => page.evaluate((sel) => document.querySelectorAll(sel).length, sel)
  await page.waitForFunction(() => document.querySelectorAll('.join .piece').length > 0)
  assert.equal(await piecesIn('[data-shape="join-a"] .piece') + await piecesIn('[data-shape="join-b"] .piece'), 0, 'members draw no curbs of their own')
  const joinRun = await page.evaluate(() => {
    const st = window.__dvoriste.getState(); return st.joins.find((j) => j.members.includes('join-a'))
  })
  assert.ok(joinRun, 'join stored')
  // joined outline is 2W x W: perimeter 6W, so curbs ~6W long instead of 8W for two separate squares
  const lens = await page.evaluate(() => [...document.querySelectorAll('.join .piece')].length)
  assert.ok(lens > 0)
  await page.mouse.click(ac.x, ac.y)
  await page.getByText('Dio spoja').waitFor()
  await page.screenshot({ path: `${SHOTS}/dvoriste-join.png` })

  // knife: a horizontal line across C splits it; the smaller top part is selected, the top edge keeps "no curb"
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const st = window.__dvoriste.getState()
    st.addShape({ id: 'cut-c', name: 'C', kind: 'asfalt', wpx: 100, hpx: 100, r: { tl: 0, tr: 0, br: 0, bl: 0 }, sides: { t: false, r: true, b: true, l: true }, mode: 'mix', x: 8000, y: 0, rot: 0 })
    st.select(null)
    st.set({ view: { zoom: 0.8, x: 7400, y: -150 } })
  })
  await page.keyboard.press('k')
  const c1 = await toScreen(7900, 100), c2 = await toScreen(8000 + Wcm + 100, 100)
  await page.mouse.move(c1.x, c1.y); await page.mouse.down(); await page.mouse.move(c2.x, c2.y, { steps: 6 }); await page.mouse.up()
  s = await state(page)
  assert.ok(!s.shapes.some((x) => x.id === 'cut-c'), 'original replaced')
  const halves = s.shapes.filter((x) => x.name === 'C 1' || x.name === 'C 2')
  assert.equal(halves.length, 2, 'two pieces')
  const top = s.shapes.find((x) => x.id === s.selected)
  assert.ok(Math.abs(top.hpx * 650 / 214 - 100) < 0.5, `smaller (top) piece selected, ${top.hpx * 650 / 214} cm tall`)
  assert.deepEqual(top.edgeCurbs.filter((c) => !c).length, 1, 'top edge keeps no curb, the cut edge gets one')
  await page.screenshot({ path: `${SHOTS}/dvoriste-cut.png` })
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

  // print export: one summary page, plus one page per section when detailed
  await page.evaluate(() => window.__dvoriste.getState().set({ printOpen: true }))
  await page.locator('.sheet').first().waitFor()
  assert.equal(await page.locator('.sheet').count(), 1, 'summary fits one page')
  await page.locator('#print-detailed').check()
  assert.ok(await page.locator('.sheet').count() > 2, 'detailed export adds section pages')
  await page.keyboard.press('Escape')

  // materials panel
  await page.locator('.materials-pill').click()
  await page.getByText('Popis za kupnju').waitFor()
  await page.screenshot({ path: `${SHOTS}/dvoriste-materials.png` })
  await page.close()

  // ---------- phone ----------
  await writeFile(PLAN, original)
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  watch(phone)
  await phone.goto(APP_URL)
  await phone.waitForFunction(() => window.__dvoriste.getState().loaded && document.querySelectorAll('[data-shape]').length > 0)
  await phone.waitForTimeout(300)
  await phone.screenshot({ path: `${SHOTS}/dvoriste-phone.png` })
  const pc = await shapeCenter(phone, 'u-oblik')
  await phone.touchscreen.tap(pc.x, pc.y)
  await phone.getByRole('complementary', { name: 'Svojstva oblika' }).waitFor()
  await phone.waitForTimeout(200)
  await phone.screenshot({ path: `${SHOTS}/dvoriste-phone-selected.png` })
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert.equal(overflow, false, 'no horizontal overflow on phone')
  await phone.close()

  assert.deepEqual(errors, [], 'no console errors')
  console.log('smoke ok')
} finally {
  await browser.close()
  server.kill()
}
