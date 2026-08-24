import { getJson, setJson } from "@/lib/server/kv";
import type { StoredCredential, UserAccount } from "@/types/auth";
import type { TradeOffer } from "@/types/trade";

/**
 * The whole point of moving auth server-side for this feature is that a
 * trade offer has to be visible to a DIFFERENT pilot on a different device —
 * something a browser-local mock account can never do. This is still a
 * prototype-grade store (one JSON blob behind `kv.ts`, not a real database
 * with indexes/queries), but it's genuinely shared and server-verified,
 * which is the part that actually matters here.
 */

export interface ServerSession {
  token: string;
  userId: string;
  expiresAt: string;
}

interface DbShape {
  users: UserAccount[];
  credentials: StoredCredential[];
  sessions: ServerSession[];
  tradeOffers: TradeOffer[];
}

const DB_KEY = "line-select:db";

function emptyDb(): DbShape {
  return { users: [], credentials: [], sessions: [], tradeOffers: [] };
}

async function readDb(): Promise<DbShape> {
  const stored = await getJson<DbShape>(DB_KEY);
  return { ...emptyDb(), ...stored };
}

async function writeDb(db: DbShape): Promise<void> {
  await setJson(DB_KEY, db);
}

// ---- Users & credentials ----

export async function findUserByEmail(email: string): Promise<UserAccount | null> {
  return (await readDb()).users.find((u) => u.email === email) ?? null;
}

export async function findUserById(id: string): Promise<UserAccount | null> {
  return (await readDb()).users.find((u) => u.id === id) ?? null;
}

export async function findCredentialByEmail(email: string): Promise<StoredCredential | null> {
  return (await readDb()).credentials.find((c) => c.email === email) ?? null;
}

export async function createUserWithCredential(
  user: UserAccount,
  credential: StoredCredential
): Promise<void> {
  const db = await readDb();
  db.users.push(user);
  db.credentials.push(credential);
  await writeDb(db);
}

// ---- Sessions ----

export async function createSession(session: ServerSession): Promise<void> {
  const db = await readDb();
  db.sessions.push(session);
  await writeDb(db);
}

export async function findSession(token: string): Promise<ServerSession | null> {
  const session = (await readDb()).sessions.find((s) => s.token === token) ?? null;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return session;
}

export async function deleteSession(token: string): Promise<void> {
  const db = await readDb();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  await writeDb(db);
}

// ---- Trade offers ----

export async function listTradeOffers(): Promise<TradeOffer[]> {
  return [...(await readDb()).tradeOffers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findTradeOffer(id: string): Promise<TradeOffer | null> {
  return (await readDb()).tradeOffers.find((o) => o.id === id) ?? null;
}

export async function createTradeOffer(offer: TradeOffer): Promise<void> {
  const db = await readDb();
  db.tradeOffers.push(offer);
  await writeDb(db);
}

export async function updateTradeOffer(
  id: string,
  patch: Partial<TradeOffer>
): Promise<TradeOffer | null> {
  const db = await readDb();
  const index = db.tradeOffers.findIndex((o) => o.id === id);
  if (index === -1) return null;
  db.tradeOffers[index] = { ...db.tradeOffers[index], ...patch };
  await writeDb(db);
  return db.tradeOffers[index];
}
