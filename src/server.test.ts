import { describe, expect, test } from "bun:test";

import { makeHandler } from "./server.ts";

let ready = true;
const handle = makeHandler({ hsToken: "hs-secret" }, { isReady: () => Promise.resolve(ready) });
const GET_TOKEN = "http://service/_matrix/client/v1/rtc/livekit/get_token";
const FROM_HOMESERVER = { authorization: "Bearer hs-secret" };

describe("handle", () => {
  test("is alive", async () => {
    const response = await handle(new Request("http://service/health/live"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
    });
  });

  test("is ready while the database answers", async () => {
    ready = true;
    expect((await handle(new Request("http://service/health/ready"))).status).toBe(200);

    ready = false;
    const response = await handle(new Request("http://service/health/ready"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
    });
  });

  test("refuses any other request without the hs_token", async () => {
    const requests = [null, "Bearer wrong", "Bearer hs-secret2", "hs-secret"].flatMap((authorization) => {
      const headers: Record<string, string> = authorization ? { authorization } : {};

      return [GET_TOKEN, "http://service//_matrix/client", "http://service/%5Fmatrix/client"].map(
        (url) => new Request(url, { method: "POST", headers }),
      );
    });
    for (const request of requests) {
      const response = await handle(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        errcode: "M_FORBIDDEN",
        error: "Not authenticated by the homeserver",
      });
    }
  });

  test("answers an unknown request from the homeserver with a Matrix 404", async () => {
    const response = await handle(new Request("http://service/elsewhere", { headers: FROM_HOMESERVER }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errcode: "M_UNRECOGNIZED",
      error: "Unrecognized request",
    });
  });
});
