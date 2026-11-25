import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

const cookieName = "sikligi_admin";
const idleTimeoutSeconds = 60 * 15;
const maxSessionSeconds = 60 * 60 * 8;

type SessionPayload = { sub: string; exp: number; max?: number; ver?: number; jti?: string };

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function readCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return entry?.slice(cookieName.length + 1);
}

function readSessionPayload(request: Request) {
  const token = readCookie(request);
  if (!token) return null;

  const [encodedPayload, receivedSignature] = token.split(".");
  if (!encodedPayload || !receivedSignature) return null;

  try {
    const expectedSignature = sign(encodedPayload);
    const expectedBuffer = Buffer.from(expectedSignature);
    const receivedBuffer = Buffer.from(receivedSignature);
    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getAdminSession(request: Request) {
  const payload = readSessionPayload(request);
  if (!payload?.jti) return null;

  try {
    const [admin, revoked] = await Promise.all([
      prisma.admin.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, branchId: true, darkMode: true, role: true, sessionVersion: true, branch: { select: { name: true } } },
      }),
      prisma.revokedSession.findUnique({ where: { id: payload.jti }, select: { id: true } }),
    ]);
    return admin && !revoked && admin.sessionVersion === payload.ver ? admin : null;
  } catch {
    return null;
  }
}

export async function revokeSession(request: Request) {
  const payload = readSessionPayload(request);
  if (!payload?.jti) return;
  const expiresAt = new Date((payload.max ?? payload.exp) * 1000);
  try {
    await prisma.revokedSession.upsert({ where: { id: payload.jti }, update: {}, create: { id: payload.jti, expiresAt } });
    await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    console.error("Session revocation failed", error);
  }
}

export function createSessionCookie(adminId: string, sessionVersion: number, maxExpiry?: number, sessionId?: string) {
  const now = Math.floor(Date.now() / 1000);
  const max = maxExpiry ?? now + maxSessionSeconds;
  const payload: SessionPayload = { sub: adminId, exp: Math.min(now + idleTimeoutSeconds, max), max, ver: sessionVersion, jti: sessionId ?? randomUUID() };
  const sessionDurationSeconds = Math.max(payload.exp - now, 0);
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encodedPayload}.${sign(encodedPayload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationSeconds}${secure}`;
}

export function refreshSessionCookie(request: Request) {
  const payload = readSessionPayload(request);
  return payload && payload.ver !== undefined && payload.jti ? createSessionCookie(payload.sub, payload.ver, payload.max ?? payload.exp, payload.jti) : null;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
