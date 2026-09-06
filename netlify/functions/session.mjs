import { json, sessionPayload } from "./_shared/auth.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });
  return json(200, sessionPayload(event));
}
