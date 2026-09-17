import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { getPersistenceMode, persistenceLabel } from "@/lib/db"

// Reports the active persistence mode so the UI can show exactly one honest
// indicator: "Persistent Database" (POSTGRES) or "In-Memory Development".
export async function GET() {
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const mode = getPersistenceMode()
  return NextResponse.json({
    mode,
    label: persistenceLabel(mode),
    persistent: mode === "POSTGRES",
  })
}
