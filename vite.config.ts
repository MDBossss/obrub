import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const PORT = Number(process.env.PORT ?? 6123)
// e2e points this at a scratch copy so tests never touch the real plan
const PLAN = resolve(__dirname, process.env.PLAN_FILE ?? 'data/plan.json')

// The plan lives in data/plan.json so it survives browsers and can be committed.
// `rev` goes up on every save; a save based on an older rev is refused, so two open
// windows (computer + phone) can't silently overwrite each other.
function planStore(): Plugin {
  const read = async () => JSON.parse(await readFile(PLAN, 'utf8').catch(() => 'null'))
  const handler = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/plan')) return next()
    const json = (code: number, v: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)) }
    try {
      if (req.method === 'GET' && req.url.startsWith('/api/plan/rev')) return json(200, { rev: (await read())?.rev ?? 0 })
      if (req.method === 'GET') return json(200, await read())
      if (req.method === 'PUT') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { baseRev, ...plan } = JSON.parse(body)
        const cur = await read(), rev = cur?.rev ?? 0
        if (baseRev !== undefined && baseRev !== rev) return json(409, cur)
        await mkdir(dirname(PLAN), { recursive: true })
        await writeFile(PLAN + '.tmp', JSON.stringify({ ...plan, rev: rev + 1 }, null, 2))
        await rename(PLAN + '.tmp', PLAN)
        return json(200, { rev: rev + 1 })
      }
      res.statusCode = 405
      res.end()
    } catch (e) {
      res.statusCode = 500
      res.end(String(e))
    }
  }
  return {
    name: 'plan-store',
    configureServer: (s) => { s.middlewares.use(handler) },
    configurePreviewServer: (s) => { s.middlewares.use(handler) },
  }
}

export default defineConfig({
  plugins: [react(), planStore()],
  server: { port: PORT, strictPort: true, host: true },
  preview: { port: PORT, strictPort: true, host: true },
})
