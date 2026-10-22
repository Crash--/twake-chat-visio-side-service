import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { CallRooms } from "./call-rooms.ts";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is required on CI");
}
const ROOM = "!room:example.org";
const SLOT = "m.call#ROOM";

describe.skipIf(!url)("CallRooms", () => {
  // Two pools: two replicas of the service
  const firstPool = new SQL(url ?? "");
  const secondPool = new SQL(url ?? "");
  const first = new CallRooms(firstPool);
  const second = new CallRooms(secondPool);

  beforeAll(async () => {
    await firstPool`DROP TABLE IF EXISTS call_rooms`;
    await Promise.all([first.migrate(), second.migrate()]);
  });

  beforeEach(async () => {
    await firstPool`TRUNCATE call_rooms`;
  });

  afterAll(async () => {
    await Promise.all([firstPool.close(), secondPool.close()]);
  });

  test("makes one Meet room when replicas ask for it together", async () => {
    let made = 0;
    const create = async (): Promise<string> => {
      made += 1;
      await Bun.sleep(50);

      return `meet-${made}`;
    };

    // Settled: a rejected call must not leave the others writing into the next test
    const rooms = await Promise.allSettled([
      first.ensure(ROOM, SLOT, create),
      second.ensure(ROOM, SLOT, create),
      first.ensure(ROOM, SLOT, create),
      second.ensure(ROOM, SLOT, create),
    ]);

    expect(made).toBe(1);
    expect(rooms.map((room) => (room.status === "fulfilled" ? room.value : room.reason))).toEqual(
      Array(4).fill("meet-1"),
    );
  });

  test("keeps the Meet room of each slot", async () => {
    await first.ensure(ROOM, SLOT, () => Promise.resolve("meet-a"));

    expect(await second.ensure(ROOM, SLOT, () => Promise.resolve("other"))).toBe("meet-a");
    expect(await second.ensure(ROOM, "other-slot", () => Promise.resolve("meet-b"))).toBe("meet-b");
    expect(await second.ensure("!other:example.org", SLOT, () => Promise.resolve("meet-c"))).toBe("meet-c");
  });

  test("writes no row when the Meet room could not be made", async () => {
    await expect(first.ensure(ROOM, SLOT, () => Promise.reject(new Error("Meet is down")))).rejects.toThrow(
      "Meet is down",
    );
    expect(await second.ensure(ROOM, SLOT, () => Promise.resolve("meet-2"))).toBe("meet-2");
  });

  test("forgets a Meet room only while it is still the linked one", async () => {
    await first.ensure(ROOM, SLOT, () => Promise.resolve("meet-1"));

    await second.forget(ROOM, SLOT, "meet-0");
    expect(await first.ensure(ROOM, SLOT, () => Promise.resolve("new"))).toBe("meet-1");

    await second.forget(ROOM, SLOT, "meet-1");
    expect(await first.ensure(ROOM, SLOT, () => Promise.resolve("meet-2"))).toBe("meet-2");
  });
});
