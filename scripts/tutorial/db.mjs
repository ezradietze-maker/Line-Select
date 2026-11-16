// Small fixes to the throwaway local database only (fixed local address; no env file is read).
//   node db.mjs confirm   — mark the demo account's email confirmed
//   node db.mjs reset     — remove the demo account, to record sign-up again
import pg from "pg";
import { ACCOUNT } from "./demo.mjs";
const c = new pg.Client({ connectionString: "postgres://postgres:postgres@127.0.0.1:55433/postgres?sslmode=disable" });
await c.connect();
const cmd = process.argv[2];
if (cmd === "confirm") console.log((await c.query("update users set email_verified_at = now() where email = $1", [ACCOUNT.email])).rowCount, "confirmed");
if (cmd === "reset") console.log((await c.query("delete from users where email = $1", [ACCOUNT.email])).rowCount, "removed");
if (cmd === "sql") console.log((await c.query(process.argv[3])).rows);
await c.end();
