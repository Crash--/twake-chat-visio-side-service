import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { Meet, type Participant } from "./meet.ts";
import { RefusedError, UpstreamError } from "./upstream.ts";

let livekitAnswer: () => Response = () => Response.json({ url: "wss://livekit", room: "meet-1", token: "the-jwt" });
let tokenStatus = 200;
const seen: { path: string; body: Record<string, unknown>; authorization: string | null }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const body = (await request.json()) as Record<string, unknown>;
    seen.push({ path: pathname, body, authorization: request.headers.get("authorization") });
    if (pathname === "/external-api/v1.0/application/token/") {
      return tokenStatus === 200
        ? Response.json({ access_token: `token-of-${body.scope}` })
        : Response.json({ error: "no" }, { status: tokenStatus });
    }
    if (pathname === "/external-api/v1.0/rooms/") {
      return Response.json({ id: "meet-1", slug: "abc-defg-hij" }, { status: 201 });
    }

    return livekitAnswer();
  },
});
const meet = new Meet({
  url: `${server.url}`,
  clientId: "chat",
  clientSecret: "meet-secret",
  serviceAccountEmail: "calls@example.org",
});
const PARTICIPANT: Participant = {
  identity: "hashed",
  username: "Alice",
  role: "member",
  matrix_user_id: "@alice:example.org",
  matrix_member_id: "member",
};

beforeEach(() => {
  seen.length = 0;
});

afterAll(() => server.stop());

describe("Meet", () => {
  test("creates a restricted room as the service account", async () => {
    expect(await meet.createRoom()).toBe("meet-1");
    expect(seen).toEqual([
      {
        path: "/external-api/v1.0/application/token/",
        body: {
          client_id: "chat",
          client_secret: "meet-secret",
          grant_type: "client_credentials",
          scope: "calls@example.org",
        },
        authorization: null,
      },
      {
        path: "/external-api/v1.0/rooms/",
        body: { access_level: "restricted" },
        authorization: "Bearer token-of-calls@example.org",
      },
    ]);
  });

  test("asks the LiveKit token as the user", async () => {
    expect(await meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).toBe("the-jwt");
    expect(seen[1]).toEqual({
      path: "/external-api/v1.0/rooms/meet-1/livekit-token/",
      body: { ...PARTICIPANT },
      authorization: "Bearer token-of-alice@example.org",
    });
  });

  test("tells a room Meet no longer has from a Meet without the route", async () => {
    livekitAnswer = () => Response.json({ detail: "Not found." }, { status: 404 });
    expect(await meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).toBeNull();

    livekitAnswer = () => new Response("<h1>Not Found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    await expect(meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).rejects.toBeInstanceOf(UpstreamError);
  });

  test("fails on a refusal of Meet", async () => {
    livekitAnswer = () => Response.json({ identity: ["invalid"] }, { status: 400 });

    await expect(meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).rejects.toBeInstanceOf(UpstreamError);
  });

  test("tells a user Meet will not act for from a failure of Meet", async () => {
    try {
      for (const status of [403, 404]) {
        tokenStatus = status;
        await expect(meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).rejects.toBeInstanceOf(
          RefusedError,
        );
        // The service account refused is a misconfiguration, not the fault of the user
        await expect(meet.createRoom()).rejects.toBeInstanceOf(UpstreamError);
      }
      tokenStatus = 500;
      await expect(meet.livekitToken("meet-1", "alice@example.org", PARTICIPANT)).rejects.toBeInstanceOf(UpstreamError);
    } finally {
      tokenStatus = 200;
    }
  });
});
