import { NextResponse } from "next/server";

function allowedOrigins() {
  const origins = new Set([process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"]);
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:5174");
    origins.add("http://localhost:3000");
  }
  return origins;
}

export function apiResponse(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return NextResponse.json(body, { status, headers });
}

export function fileResponse(request: Request, body: ArrayBuffer, contentType: string) {
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "no-store" });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return new Response(body, { status: 200, headers });
}

export function preflightResponse(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(null, { status: 204, headers });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().has(origin)) {
    throw new ApiError(403, "Asal permintaan tidak diizinkan");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Format data tidak valid.");
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
