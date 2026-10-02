import Fastify from "fastify";

// Skeleton only. Product endpoints arrive with T07+; nothing here touches client data or providers.
export function buildApp(allowedOrigin = process.env.APP_ORIGIN ?? "") {
  const app = Fastify({ logger: true, bodyLimit: 16 * 1024 });

  app.addHook("onSend", async (req, reply) => {
    // Exact-match CORS for the dashboard origin only; no wildcard.
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      reply.header("access-control-allow-origin", allowedOrigin);
      reply.header("vary", "Origin");
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "contextharbor-api",
    stage: "skeleton",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  }));

  return app;
}
