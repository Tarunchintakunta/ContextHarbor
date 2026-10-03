import { buildApp } from "./app.js";
import { connect, migrate } from "./db.js";

const db = process.env.DATABASE_URL ? connect(process.env.DATABASE_URL) : undefined;
if (db) await migrate(db);
const app = buildApp({ db });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });

// Graceful drain on platform shutdown.
for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void app.close().then(() => db?.end()).then(() => process.exit(0)));
