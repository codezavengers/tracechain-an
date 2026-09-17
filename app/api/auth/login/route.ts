import { NextResponse } from "next/server"
import { ensureSeeded, findUserByEmail, DEMO_CREDENTIALS } from "@/lib/store"
import { verifyPassword, signToken } from "@/lib/auth"
import { AUTH_COOKIE } from "@/lib/api/session"

// Salt lookup mirrors the seed salts (demo). In production, salt is stored per-user.
const SALTS: Record<string, string> = {
  "admin@tracechain.gov": "s_admin",
  "investigator@tracechain.gov": "s_inv",
  "analyst@tracechain.gov": "s_analyst",
  "viewer@tracechain.gov": "s_viewer",
}

export async function POST(req: Request) {
  await ensureSeeded()
  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }
  const email = (body.email ?? "").trim()
  const password = body.password ?? ""
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 })
  }

  const user = findUserByEmail(email)
  const salt = SALTS[email.toLowerCase()]
  if (!user || !salt || !(await verifyPassword(password, salt, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 })
  }

  const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role }
  const token = await signToken(sessionUser)
  const res = NextResponse.json({ user: sessionUser })
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  })
  return res
}

// Expose demo credentials so the login page can show them (demo convenience).
export async function GET() {
  return NextResponse.json({ demoCredentials: DEMO_CREDENTIALS })
}
