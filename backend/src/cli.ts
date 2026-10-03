// Usage: DATABASE_URL=... APP_ORIGIN=https://contextharbor.vercel.app node dist/cli.js setup-link
import { createSetupLink } from "./app.js";
import { connect, migrate } from "./db.js";

const [cmd] = process.argv.slice(2);
if (cmd !== "setup-link" || !process.env.DATABASE_URL || !process.env.APP_ORIGIN) {
  console.error("usage: DATABASE_URL=... APP_ORIGIN=... node dist/cli.js setup-link");
  process.exit(2);
}
const db = connect(process.env.DATABASE_URL);
await migrate(db);
console.log(await createSetupLink(db, process.env.APP_ORIGIN));
await db.end();
