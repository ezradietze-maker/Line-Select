import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool } from "@/lib/server/postgres";

/**
 * The pool against a stand-in Postgres that only answers the startup handshake (auth OK, ready), so a client
 * can connect and sit idle with no real database. On a query it resets the connection, as a dropped network
 * does mid-query.
 */
function fakePostgres(): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let started = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (!started) {
        started = true;
        const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
        const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
        socket.write(Buffer.concat([authOk, ready]));
      } else if (chunk[0] === 0x51) {
        socket.resetAndDestroy();
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** What a dropped network does to the client's socket: the read fails, as in the Nov 13 log. */
function dropSocket(client: PoolClient) {
  const stream = (client as unknown as { connection: { stream: net.Socket } }).connection.stream;
  stream.destroy(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("createPool", () => {
  let server: net.Server;
  let pool: Pool;
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);

  beforeEach(async () => {
    uncaught.length = 0;
    process.on("uncaughtException", onUncaught);
    vi.spyOn(console, "error").mockImplementation(() => {});
    server = await fakePostgres();
    const { port } = server.address() as AddressInfo;
    pool = createPool(`postgres://user:pw@127.0.0.1:${port}/db`);
  });

  afterEach(async () => {
    process.off("uncaughtException", onUncaught);
    vi.restoreAllMocks();
    await pool.end().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  });

  it("logs a socket error on an idle client and drops it, without an uncaught exception", async () => {
    const client = await pool.connect();
    client.release();
    expect(pool.idleCount).toBe(1);

    dropSocket(client);
    await settle();

    expect(uncaught).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[postgres]"), "read ETIMEDOUT");
    expect(pool.totalCount).toBe(0);
  });

  it("logs a socket error on a checked-out client between queries, and drops it on release", async () => {
    const client = await pool.connect();

    dropSocket(client);
    await settle();
    client.release();

    expect(uncaught).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[postgres]"), "read ETIMEDOUT");
    expect(pool.totalCount).toBe(0);
  });

  it("rejects a query whose connection resets, so the route sees an ordinary error", async () => {
    await expect(pool.query("select 1")).rejects.toMatchObject({ code: "ECONNRESET" });
    await settle();

    expect(uncaught).toEqual([]);
  });
});
