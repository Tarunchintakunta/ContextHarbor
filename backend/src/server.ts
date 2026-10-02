import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });

// Graceful drain on platform shutdown.
for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void app.close().then(() => process.exit(0)));
