import type { Role, SessionUser } from "@/lib/types"

// Lightweight JWT (HS256) using the Web Crypto API. No external deps.
// Secret comes from env; falls back to a clearly-labeled demo secret locally.
const encoder = new TextEncoder()

const DEMO_JWT_SECRET = "tracechain-demo-secret-not-for-production"
let warnedAboutDemoSecret = false

function getSecret(): string {
  const secret = process.env.TRACECHAIN_JWT_SECRET
  if (!secret) {
    // A publicly-known fallback secret means anyone can forge a session
    // token (including an ADMIN role) — safe for local demo use only. Warn
    // loudly, once, instead of silently signing production sessions with a
    // secret that ships in this file's source.
    if (!warnedAboutDemoSecret) {
      warnedAboutDemoSecret = true
      console.warn(
        "[v0] SECURITY WARNING: TRACECHAIN_JWT_SECRET is not set. Falling back to a public, " +
          "hardcoded demo secret — session tokens can be forged by anyone who reads this " +
          "source file. Set TRACECHAIN_JWT_SECRET before deploying this application.",
      )
    }
    return DEMO_JWT_SECRET
  }
  return secret
}

function base64url(input: ArrayBuffer | string): string {
  let bytes: Uint8Array
  if (typeof input === "string") {
    bytes = encoder.encode(input)
  } else {
    bytes = new Uint8Array(input)
  }
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4))
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad
  const binary = atob(b64)
  return binary
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return base64url(sig)
}

export interface JwtPayload extends SessionUser {
  iat: number
  exp: number
}

export async function signToken(user: SessionUser, ttlSeconds = 60 * 60 * 8): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const payload: JwtPayload = { ...user, iat: now, exp: now + ttlSeconds }
  const encHeader = base64url(JSON.stringify(header))
  const encPayload = base64url(JSON.stringify(payload))
  const signature = await hmac(`${encHeader}.${encPayload}`)
  return `${encHeader}.${encPayload}.${signature}`
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const [encHeader, encPayload, signature] = token.split(".")
    if (!encHeader || !encPayload || !signature) return null
    const expected = await hmac(`${encHeader}.${encPayload}`)
    if (expected !== signature) return null
    const payload = JSON.parse(base64urlDecode(encPayload)) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// SHA-256 password hashing with static-per-user salt (demo grade).
export async function hashPassword(password: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}:${password}`))
  return base64url(buf)
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const h = await hashPassword(password, salt)
  return h === hash
}

// RBAC permission matrix.
const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  ANALYST: 2,
  INVESTIGATOR: 3,
  ADMIN: 4,
}

export function hasAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export const PERMISSIONS = {
  createCase: (r: Role) => hasAtLeast(r, "INVESTIGATOR"),
  runInvestigation: (r: Role) => hasAtLeast(r, "ANALYST"),
  editCase: (r: Role) => hasAtLeast(r, "INVESTIGATOR"),
  manageUsers: (r: Role) => hasAtLeast(r, "ADMIN"),
  exportReport: (r: Role) => hasAtLeast(r, "ANALYST"),
  acknowledgeAlert: (r: Role) => hasAtLeast(r, "ANALYST"),
  view: (_r: Role) => true,
}
