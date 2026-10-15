import { claudeModelFromEnv } from "@/lib/documents/generation/claude"
import { handleModelRequest } from "@/lib/documents/generation/modelRoute"

// The document generator's model route (D-56). It forwards one model request
// and streams back the candidate proposal; it saves nothing and trusts nothing
// (the caller's gate checks every proposal). Development and Vercel previews
// only — 404 in production — and it never logs prompt content.

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview") {
    return new Response("Not found", { status: 404 })
  }
  return handleModelRequest(request, claudeModelFromEnv())
}
