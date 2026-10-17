import { z } from "zod"

import { runTurn } from "@/lib/output-system/agent/loop"
import { modelCall, ModelUnavailableError, readRepoFiles, SpendLimitError } from "@/lib/output-system/agent/server"
import { ANCHOR_DATE, sampleStore } from "@/lib/output-system/fixtures/stores"

// The /output-verify model route (D-80). It lives under /output-verify/ so the
// development-only proxy line for /output-verify (D-78) covers it; /api/* goes
// through Auth0's middleware, which needs Auth0 settings this prototype has no use for. One turn: the model reads the guide,
// asks the sample store, and returns one thing to show. Development only: 404
// everywhere else, Vercel previews included (D-78). It never logs prompt
// content. Its reply is NDJSON: progress lines, then one result line.

export const dynamic = "force-dynamic"
export const maxDuration = 300

const MAX_BODY_BYTES = 200_000

const BodySchema = z.object({
  storeId: z.enum(["saffron-loom", "fernhill-goods"]),
  history: z.array(z.object({ role: z.enum(["person", "souvenir"]), text: z.string().max(8000) })).max(40),
  request: z.string().min(1).max(4000),
  upload: z
    .object({
      fileName: z.string().max(200),
      format: z.enum(["csv", "xlsx"]),
      sheet: z.string().max(100),
      columns: z.array(z.string().max(200)).max(100),
      rowCount: z.number().int().min(0),
      sampleRows: z.array(z.array(z.unknown())).max(10),
    })
    .optional(),
})

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "This request is too large." }, { status: 413 })
  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(JSON.parse(raw))
  } catch {
    return Response.json({ error: "This request isn’t in the expected shape." }, { status: 400 })
  }

  const repo = readRepoFiles()
  let call
  try {
    call = modelCall({ session: process.env.OUTPUT_BUILD_SESSION ?? "adhoc", lane: "app", purpose: "output-verify", repo, cache: process.env.OUTPUT_CACHE !== "0" }).call
  } catch (e) {
    if (e instanceof ModelUnavailableError) return Response.json({ error: "No model key is set up, so Souvenir can’t make anything yet." }, { status: 503 })
    throw e
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      try {
        const result = await runTurn({
          store: sampleStore(body.storeId),
          history: body.history,
          request: body.request,
          upload: body.upload as never,
          prompt: repo.prompt,
          guides: repo.guides,
          formats: repo.formats,
          call,
          today: ANCHOR_DATE,
          onEvent: (e) => {
            if (e.type === "progress") send(e)
          },
        })
        send({ type: "result", made: result.made })
      } catch (e) {
        const message =
          e instanceof SpendLimitError
            ? "The spending limit for this build has been reached, so Souvenir stopped."
            : "Souvenir couldn’t reach the model just now. Try again in a moment."
        send({ type: "result", made: { kind: "error", message } })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } })
}
