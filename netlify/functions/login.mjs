import { adminAccessKey, json, loginCookie, safeEqual } from "./_shared/auth.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const accessKey = adminAccessKey();
  if (!accessKey) return json(503, { ok: false, error: "Admin login is not configured" });
  if (!safeEqual(payload.accessKey || "", accessKey)) {
    return json(401, { ok: false, error: "Invalid access key" });
  }

  return json(200, { ok: true, status: "admin" }, {
    "Set-Cookie": loginCookie()
  });
}
