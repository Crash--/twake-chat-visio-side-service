import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { Homeserver } from "./homeserver.ts";
import { UpstreamError } from "./upstream.ts";

const ALICE = "@alice:example.org";
const ROOM = "!room:example.org";

let answers: Record<string, () => Response> = {};
const seen: { path: string; query: Record<string, string>; authorization: string | null }[] = [];
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    seen.push({
      path: decodeURIComponent(url.pathname),
      query: Object.fromEntries(url.searchParams),
      authorization: request.headers.get("authorization"),
    });
    const answer = answers[decodeURIComponent(url.pathname)];

    return answer ? answer() : Response.json({ errcode: "M_NOT_FOUND" }, { status: 404 });
  },
});
const homeserver = new Homeserver(`${server.url}`, "as-secret");

const createPath = `/_matrix/client/v3/rooms/${ROOM}/state/m.room.create/`;
const powerLevelsPath = `/_matrix/client/v3/rooms/${ROOM}/state/m.room.power_levels/`;

function room(version: string, sender: string, powerLevels: Record<string, unknown>): void {
  answers[createPath] = () =>
    Response.json({ type: "m.room.create", sender, content: { room_version: version, additional_creators: [] } });
  answers[powerLevelsPath] = () => Response.json({ type: "m.room.power_levels", content: powerLevels });
}

beforeEach(() => {
  answers = {};
  seen.length = 0;
});

afterAll(() => server.stop());

describe("Homeserver", () => {
  test("asks is_joined of MSC4502 with the as_token", async () => {
    answers[`/_matrix/client/unstable/io.element.msc4502/rooms/${ROOM}/is_joined`] = () =>
      Response.json({ joined: true });

    expect(await homeserver.isJoined(ROOM, ALICE)).toBe(true);
    expect(seen).toEqual([
      {
        path: `/_matrix/client/unstable/io.element.msc4502/rooms/${ROOM}/is_joined`,
        query: { mxid: ALICE },
        authorization: "Bearer as-secret",
      },
    ]);
  });

  test("fails when is_joined fails", async () => {
    await expect(homeserver.isJoined(ROOM, ALICE)).rejects.toBeInstanceOf(UpstreamError);
  });

  test("reads the state as the user, with the sender of the events", async () => {
    room("10", "@bob:example.org", {});
    await homeserver.isModerator(ROOM, ALICE);

    expect(seen.map(({ query }) => query)).toEqual([
      { user_id: ALICE, format: "event" },
      { user_id: ALICE, format: "event" },
    ]);
  });

  test("makes a moderator of a power level of 50 or more, users_default included", async () => {
    room("10", "@bob:example.org", { users: { [ALICE]: 50 } });
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(true);

    room("10", "@bob:example.org", { users: { [ALICE]: 49 }, users_default: 100 });
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(false);

    room("10", "@bob:example.org", { users_default: 50 });
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(true);

    room("10", "@bob:example.org", {});
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(false);

    room("9", "@bob:example.org", { users: { [ALICE]: "50" } });
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(true);
  });

  test("makes a moderator of a creator from room version 12, not before", async () => {
    room("12", ALICE, {});
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(true);

    room("11", ALICE, {});
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(false);

    answers[createPath] = () =>
      Response.json({ sender: "@bob:example.org", content: { room_version: "12", additional_creators: [ALICE] } });
    expect(await homeserver.isModerator(ROOM, ALICE)).toBe(true);
  });

  test("reads the display name as the user, null without one", async () => {
    answers[`/_matrix/client/v3/profile/${ALICE}/displayname`] = () => Response.json({ displayname: "Alice" });
    expect(await homeserver.displayName(ALICE)).toBe("Alice");
    expect(seen[0]?.query).toEqual({ user_id: ALICE });

    answers = {};
    expect(await homeserver.displayName(ALICE)).toBeNull();
  });
});
