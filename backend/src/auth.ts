import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Format: scrypt$N$r$p$salt$hash (base64url). Node's built-in scrypt; no custom crypto. */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string | null) {
  // Hash against a fixed dummy when the account has no password, so timing doesn't reveal which accounts exist.
  const parts = (stored ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").split("$");
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), expected.length, { N: +N, r: +r, p: +p, maxmem: PARAMS.maxmem });
  return stored !== null && got.length === expected.length && timingSafeEqual(got, expected);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

export function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 12 && pw.length <= 200;
}

export function normalizeEmail(e: unknown) {
  if (typeof e !== "string") return null;
  const v = e.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Fixed-window limiter for login attempts. ponytail: in-memory, per instance; move to Postgres if we scale out. */
export class Limiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}
  blocked(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    return !!h && h.until > now && h.n >= this.max;
  }
  fail(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || h.until <= now) this.hits.set(key, { n: 1, until: now + this.windowMs });
    else h.n++;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
