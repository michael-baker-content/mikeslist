import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "show_explorer_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    },
    body: JSON.stringify(payload)
  };
}

export function adminAccessKey() {
  return process.env.SHOW_EXPLORER_ADMIN_KEY || "";
}

export function sessionPayload(event) {
  const session = readSession(event);
  return {
    authenticated: Boolean(session),
    status: session?.status || "public",
    admin: session?.status === "admin"
  };
}

export function requireAdmin(event) {
  return Boolean(readSession(event)?.status === "admin");
}

export function loginCookie() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ status: "admin", expiresAt })).toString("base64url");
  const signature = sign(payload);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function logoutCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readSession(event) {
  const token = cookiesFor(event)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function cookiesFor(event) {
  const header = event.headers.cookie || event.headers.Cookie || "";
  return Object.fromEntries(header.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return [name, decodeURIComponent(rest.join("="))];
  }).filter(([name]) => name));
}

function sign(value) {
  const secret = adminAccessKey();
  if (!secret) return "";
  return createHmac("sha256", secret).update(value).digest("base64url");
}
