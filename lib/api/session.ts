import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import type { SessionUser, Role } from "@/lib/types"

export const AUTH_COOKIE = "tracechain_token"

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(AUTH_COOKIE)?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  return { id: payload.id, email: payload.email, name: payload.name, role: payload.role }
}

// Require an authenticated session; returns user or a 401 response.
export async function requireUser(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser()
  if (!user) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) }
  }
  return { user }
}

// Require a minimum role; returns user or a 401/403 response.
export async function requireRole(
  check: (r: Role) => boolean,
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser()
  if (!user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) }
  if (!check(user.role)) {
    return { response: NextResponse.json({ error: "Insufficient permissions for this action." }, { status: 403 }) }
  }
  return { user }
}
