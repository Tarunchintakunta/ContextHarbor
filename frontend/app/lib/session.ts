import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface Me {
  email: string;
  role: "admin" | "member";
  workspace: { id: string; name: string } | null;
}

const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

/** Server-side session check: forwards the visitor's cookie to the API. */
export async function getMe(): Promise<Me | null> {
  const session = (await cookies()).get("ch_session");
  if (!API || !session) return null;
  try {
    const r = await fetch(`${API}/v1/me`, { headers: { cookie: `ch_session=${session.value}` }, cache: "no-store" });
    return r.ok ? ((await r.json()) as Me) : null;
  } catch {
    return null;
  }
}

export async function requireMe(role?: Me["role"]) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (role && me.role !== role) redirect(me.role === "admin" ? "/admin" : "/dashboard");
  return me;
}
