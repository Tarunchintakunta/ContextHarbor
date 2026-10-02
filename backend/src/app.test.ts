import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";

test("health returns ok and CORS only for the allowed origin", async () => {
  const app = buildApp("https://dash.example");
  const ok = await app.inject({ url: "/health", headers: { origin: "https://dash.example" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, "ok");
  assert.equal(ok.headers["access-control-allow-origin"], "https://dash.example");
  const other = await app.inject({ url: "/health", headers: { origin: "https://evil.example" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined);
  await app.close();
});
