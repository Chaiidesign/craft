import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// D-80: the model route is for development only, and the key stays on the server.
describe('/output-verify/model', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is not found in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await POST(new Request('http://x/output-verify/model', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(404)
  })

  it('refuses a body it does not expect, before any model call', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await POST(new Request('http://x/output-verify/model', { method: 'POST', body: JSON.stringify({ storeId: 'nowhere' }) }))
    expect(res.status).toBe(400)
  })

  it('never sends the key: with no key it says so in words, and nothing else leaves the server', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const res = await POST(new Request('http://x/output-verify/model', { method: 'POST', body: JSON.stringify({ storeId: 'fernhill-goods', history: [], request: 'hi' }) }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'No model key is set up, so Souvenir can’t make anything yet.' })
  })
})
