import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { buildCaseSummary } from "@/lib/investigation/case-summary"

const ID_RE = /^[A-Za-z0-9_-]+$/

// Returns a concise, decision-support case summary assembled from the case,
// its multi-engine result, and its evidence chain.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const { id } = await params
  if (!id || !ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid investigation id." }, { status: 400 })
  }

  const summary = buildCaseSummary(id)
  if (!summary) return NextResponse.json({ error: "Case not found." }, { status: 404 })
  return NextResponse.json({ summary })
}
