// A local stand-in for the Anthropic Messages API, for checking the chat page
// by hand without a key or network. It speaks the real streaming protocol
// (server-sent events with input_json_delta chunks), so the real ClaudeModel
// and SDK parse it exactly as they would Claude. Its answers are scripted from
// the request text and are not model output. Development only.
//
//   npx vite-node scripts/documents/mock-anthropic.ts            # listens on :4019
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:4019 npx next dev -p 4010

import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 4019)
const CHUNK_DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 60)

type Field = { id: string; digest: string }
type Line = { id: string; digest: string }

function proposalFor(body: { messages: { content: string }[] }): unknown {
  const req = JSON.parse(body.messages[0].content) as { request: string; document: { fields: Field[]; lineItems: Line[] } }
  const text = req.request.toLowerCase()
  const digest = (id: string) => req.document.fields.find((f) => f.id === id)?.digest
  const intent = { docType: 'invoice', audience: 'recipient', summary: 'Invoice' }
  if (/memo|report|deck|letter/.test(text)) return { intent: { ...intent, docType: 'other', summary: 'A memo' }, statedAmount: null, operations: [], followUp: null }
  const add = /add a line item: ([^,]+), \$([\d,]+)/i.exec(req.request)
  if (add) {
    return {
      intent, statedAmount: null, followUp: null,
      operations: [{ op: 'addLineItem', description: add[1].replace(/^\w/, (c) => c.toUpperCase()), quantity: '1', unitPrice: { amount: add[2].replace(/,/g, '') }, provenance: { source: 'prompt', evidence: `${add[1]}, $${add[2]}` } }],
    }
  }
  const due = /due in (\d+) days/i.exec(req.request)
  if (due) {
    return {
      intent, statedAmount: null, followUp: 'What is the invoice date?',
      operations: [{ op: 'setField', fieldId: 'payment.terms', expectedDigest: digest('payment.terms'), value: { type: 'text', text: `Due within ${due[1]} days of the invoice date.` }, provenance: { source: 'prompt', evidence: due[0] } }],
    }
  }
  const inv = /invoice for ([^,]+), \$([\d,]+)/i.exec(req.request)
  if (inv) {
    const amount = inv[2].replace(/,/g, '')
    return {
      intent: { ...intent, summary: `Invoice to ${inv[1]}` },
      statedAmount: { amount, evidence: `$${inv[2]}` },
      followUp: `What does the $${inv[2]} cover?`,
      operations: [
        { op: 'setField', fieldId: 'buyer.name', value: { type: 'text', text: inv[1] }, provenance: { source: 'prompt', evidence: inv[1] } },
        { op: 'setField', fieldId: 'invoice.currency', value: { type: 'currency', code: 'USD' }, provenance: { source: 'prompt', evidence: `$${inv[2]}` } },
        { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount }, provenance: { source: 'prompt', evidence: `$${inv[2]}` } },
      ],
    }
  }
  return { intent, statedAmount: null, operations: [], followUp: 'Who is the invoice for, and for how much?' }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const input = JSON.stringify(proposalFor(body))
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  send('message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_mock', name: 'submit_proposal', input: {} } })
  for (let i = 0; i < input.length; i += 24) {
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input.slice(i, i + 24) } })
    await sleep(CHUNK_DELAY_MS)
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 100 } })
  send('message_stop', { type: 'message_stop' })
  res.end()
}).listen(PORT, () => process.stdout.write(`Mock Anthropic API on http://localhost:${PORT} (scripted answers, not a model)\n`))
