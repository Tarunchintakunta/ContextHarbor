// Browser calls go through the same-origin /api proxy. The custom header is the CSRF guard the API requires.
export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-ch-csrf": "1" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  const data = (await r.json().catch(() => ({}))) as T;
  return { ok: r.ok, status: r.status, data };
}

export const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  too_many_attempts: "Too many attempts. Wait 15 minutes, then try again.",
  invalid_or_used_link: "This link has expired or was already used. Ask your admin for a new one.",
  invalid_input: "Check the fields: passwords need at least 12 characters.",
  email_taken: "That email already has an account.",
};
