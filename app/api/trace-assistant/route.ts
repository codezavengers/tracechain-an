import { NextResponse } from "next/server"
import { ensureSeeded, getCase, getInvestigation } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { askTraceAssistant, ASSISTANT_SUGGESTIONS } from "@/lib/engines/trace-assistant"

export async function GET() {
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  return NextResponse.json({ suggestions: ASSISTANT_SUGGESTIONS })
}

export async function POST(req: Request) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const body = await req.json().catch(() => ({}))
  const question = (body?.question ?? "").toString().trim()
  const caseId = (body?.caseId ?? "").toString()
  if (!question) return NextResponse.json({ error: "A question is required." }, { status: 400 })
  const c = getCase(caseId)
  if (!c) return NextResponse.json({ error: "Select a valid case to query." }, { status: 404 })
  const investigation = getInvestigation(caseId) ?? null
  const answer = askTraceAssistant(question, { case: c, investigation })
  return NextResponse.json({ answer })
}
