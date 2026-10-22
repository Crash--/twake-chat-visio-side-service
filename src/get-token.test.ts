import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

import { getToken, livekitIdentity, type TokenDeps } from "./get-token.ts";
import type { Participant } from "./meet.ts";
import { UpstreamError } from "./upstream.ts";

const ALICE = "@alice:example.org";
const ROOM = "!room:example.org";
const LIVEKIT = "wss://livekit.example.org";
const BODY = { url: LIVEKIT, room_id: ROOM, slot_id: "m.call#ROOM", member_id: "xyzABCDEF10123" };

const sha256 = (text: string): string => createHash("sha256").update(text).digest("base64").replace(/=+$/, "");

function fakes() {
  const links = new Map<string, string>();
  let rooms = 0;
  const deps = {
    livekitUrl: LIVEKIT,
    homeserver: {
      isJoined: mock(() => Promise.resolve(true)),
      isModerator: mock(() => Promise.resolve(false)),
      displayName: mock((): Promise<string | null> => Promise.resolve("Alice")),
    },
    directory: {
      entry: mock(() =>
        Promise.resolve<{ email: string | null; twakeInstance: string | null }>({
          email: "alice@example.org",
          twakeInstance: "https://alice.example.org",
        }),
      ),
    },
    meet: {
      createRoom: mock(() => Promise.resolve(`meet-${++rooms}`)),
      livekitToken: mock(
        (_room: string, _email: string, _participant: Participant): Promise<string | null> =>
          Promise.resolve("the-jwt"),
      ),
    },
    callRooms: {
      ensure: mock(async (roomId: string, slotId: string, create: () => Promise<string>) => {
        const key = `${roomId} ${slotId}`;
        const known = links.get(key) ?? (await create());
        links.set(key, known);
        return known;
      }),
      forget: mock((roomId: string, slotId: string, meetRoomId: string) => {
        if (links.get(`${roomId} ${slotId}`) === meetRoomId) {
          links.delete(`${roomId} ${slotId}`);
        }
        return Promise.resolve();
      }),
    },
  } satisfies TokenDeps;

  return deps;
}

let deps = fakes();

function ask(body: unknown, user: string | null = ALICE): Promise<Response> {
  return getToken(
    new Request("http://service/_matrix/client/v1/rtc/livekit/get_token", {
      method: "POST",
      headers: user ? { "x-matrix-user-identifier": user } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps,
  );
}

async function refusal(response: Response): Promise<[number, unknown]> {
  return [response.status, ((await response.json()) as { errcode: string }).errcode];
}

beforeEach(() => {
  deps = fakes();
});

describe("livekitIdentity", () => {
  test("hashes the canonical JSON of the sender and the member id, unpadded", () => {
    expect(livekitIdentity(ALICE, "xyzABCDEF10123")).toBe(sha256('["@alice:example.org","xyzABCDEF10123"]'));
    expect(livekitIdentity("@élise:example.org", "mémber")).toBe(sha256('["@élise:example.org","mémber"]'));
    expect(livekitIdentity(ALICE, "xyzABCDEF10123")).toMatch(/^[A-Za-z0-9+/]{43}$/);
  });
});

describe("getToken", () => {
  test("answers the token Meet minted for the member", async () => {
    const response = await ask(BODY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jwt: "the-jwt" });
    expect(deps.homeserver.isJoined).toHaveBeenCalledWith(ROOM, ALICE);
    expect(deps.directory.entry).toHaveBeenCalledWith("alice");
    expect(deps.meet.livekitToken).toHaveBeenCalledWith("meet-1", "alice@example.org", {
      identity: livekitIdentity(ALICE, "xyzABCDEF10123"),
      username: "Alice",
      role: "member",
      matrix_user_id: ALICE,
      matrix_member_id: "xyzABCDEF10123",
      twake_instance: "https://alice.example.org",
    });
  });

  test("keeps one Meet room per slot", async () => {
    await ask(BODY);
    await ask(BODY);
    await ask({ ...BODY, slot_id: "other" });

    expect(deps.meet.createRoom).toHaveBeenCalledTimes(2);
    expect(deps.meet.livekitToken.mock.calls.map(([room]) => room)).toEqual(["meet-1", "meet-1", "meet-2"]);
  });

  test("takes the explicit server name of this homeserver and a trailing slash on the url", async () => {
    expect((await ask({ ...BODY, server_name: "example.org", url: `${LIVEKIT}/` })).status).toBe(200);
  });

  test("makes a moderator an administrator of the Meet room", async () => {
    deps.homeserver.isModerator.mockImplementation(() => Promise.resolve(true));
    await ask(BODY);

    expect(deps.meet.livekitToken.mock.calls[0]?.[2].role).toBe("administrator");
  });

  test("joins as a member when the role cannot be read", async () => {
    deps.homeserver.isModerator.mockImplementation(() => Promise.reject(new UpstreamError("homeserver", "down")));

    expect((await ask(BODY)).status).toBe(200);
    expect(deps.meet.livekitToken.mock.calls[0]?.[2].role).toBe("member");
  });

  test("names the participant by the localpart without a display name, at most 255 characters", async () => {
    deps.homeserver.displayName.mockImplementation(() => Promise.resolve(null));
    await ask(BODY);
    deps.homeserver.displayName.mockImplementation(() => Promise.resolve("é".repeat(300)));
    await ask(BODY);

    const [first, second] = deps.meet.livekitToken.mock.calls.map(([, , participant]) => participant.username);
    expect(first).toBe("alice");
    expect(second).toBe("é".repeat(255));
  });

  test("leaves the Twake instance out when the directory has none", async () => {
    deps.directory.entry.mockImplementation(() => Promise.resolve({ email: "alice@example.org", twakeInstance: null }));
    await ask(BODY);

    expect(deps.meet.livekitToken.mock.calls[0]?.[2]).not.toHaveProperty("twake_instance");
  });

  test("replaces a Meet room that Meet no longer has, once", async () => {
    deps.meet.livekitToken.mockImplementationOnce(() => Promise.resolve(null));
    const response = await ask(BODY);

    expect(await response.json()).toEqual({ jwt: "the-jwt" });
    expect(deps.callRooms.forget).toHaveBeenCalledWith(ROOM, "m.call#ROOM", "meet-1");
    expect(deps.meet.livekitToken.mock.calls.map(([room]) => room)).toEqual(["meet-1", "meet-2"]);
  });

  test("fails when the new Meet room is not found either", async () => {
    deps.meet.livekitToken.mockImplementation(() => Promise.resolve(null));

    await expect(ask(BODY)).rejects.toBeInstanceOf(UpstreamError);
  });

  test("refuses a request without a user, as from the federation", async () => {
    expect(await refusal(await ask(BODY, null))).toEqual([403, "M_FORBIDDEN"]);
  });

  test("refuses a body that is not JSON, or not a JSON object", async () => {
    expect(await refusal(await ask("{"))).toEqual([400, "M_NOT_JSON"]);
    for (const body of ["[]", "null", "1"]) {
      expect(await refusal(await ask(body))).toEqual([400, "M_BAD_JSON"]);
    }
  });

  test("refuses a missing or empty field", async () => {
    for (const name of ["url", "room_id", "slot_id", "member_id"]) {
      const { [name as keyof typeof BODY]: _, ...rest } = BODY;

      expect(await refusal(await ask(rest))).toEqual([400, "M_MISSING_PARAM"]);
      expect(await refusal(await ask({ ...BODY, [name]: "" }))).toEqual([400, "M_INVALID_PARAM"]);
      expect(await refusal(await ask({ ...BODY, [name]: 1 }))).toEqual([400, "M_INVALID_PARAM"]);
    }
  });

  test("refuses the SFU of another homeserver", async () => {
    expect(await refusal(await ask({ ...BODY, server_name: "other.org" }))).toEqual([403, "M_FORBIDDEN"]);
    expect(await refusal(await ask({ ...BODY, url: "wss://livekit.other.org" }))).toEqual([400, "M_INVALID_PARAM"]);
  });

  test("refuses a server name that is not a string", async () => {
    for (const serverName of [null, 1]) {
      expect(await refusal(await ask({ ...BODY, server_name: serverName }))).toEqual([400, "M_INVALID_PARAM"]);
    }
  });

  test("refuses what is not a room id", async () => {
    expect(await refusal(await ask({ ...BODY, room_id: "#alias:example.org" }))).toEqual([400, "M_INVALID_PARAM"]);
  });

  test("refuses a user who is not joined to the room, before asking Meet", async () => {
    deps.homeserver.isJoined.mockImplementation(() => Promise.resolve(false));

    expect(await refusal(await ask(BODY))).toEqual([403, "M_FORBIDDEN"]);
    expect(deps.meet.createRoom).not.toHaveBeenCalled();
    expect(deps.meet.livekitToken).not.toHaveBeenCalled();
  });

  test("refuses a user without a single email in the directory", async () => {
    deps.directory.entry.mockImplementation(() => Promise.resolve({ email: null, twakeInstance: null }));

    expect(await refusal(await ask(BODY))).toEqual([403, "M_FORBIDDEN"]);
    expect(deps.meet.livekitToken).not.toHaveBeenCalled();
  });

  test("lets a failure of the directory or Meet through", async () => {
    deps.directory.entry.mockImplementation(() => Promise.reject(new UpstreamError("directory", "down")));

    await expect(ask(BODY)).rejects.toBeInstanceOf(UpstreamError);
  });
});
