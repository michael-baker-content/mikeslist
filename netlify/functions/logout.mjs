import { json, logoutCookie } from "./_shared/auth.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  return json(200, { ok: true, status: "public" }, {
    "Set-Cookie": logoutCookie()
  });
}
