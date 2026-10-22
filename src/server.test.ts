import { describe, expect, test } from "bun:test";

import { makeHandler } from "./server.ts";

const handle = makeHandler({ hsToken: "hs-secret" });
const GET_TOKEN = "http://service/_matrix/client/v1/rtc/livekit/get_token";
const FROM_HOMESERVER = { authorization: "Bearer hs-secret" };

describe("handle", () => {
  test("answers the probes without the hs_token", async () => {
    for (const path of ["/health/live", "/health/ready"]) {
      const response = handle(new Request(`http://service${path}`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
      });
    }
  });

  test("refuses any other request without the hs_token", async () => {
    const requests = [null, "Bearer wrong", "Bearer hs-secret2", "hs-secret"].flatMap((authorization) => {
      const headers: Record<string, string> = authorization ? { authorization } : {};

      return [GET_TOKEN, "http://service//_matrix/client", "http://service/%5Fmatrix/client"].map(
        (url) => new Request(url, { method: "POST", headers }),
      );
    });
    for (const request of requests) {
      const response = handle(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        errcode: "M_FORBIDDEN",
        error: "Not authenticated by the homeserver",
      });
    }
  });

  test("answers an unknown request from the homeserver with a Matrix 404", async () => {
    const response = handle(new Request("http://service/elsewhere", { headers: FROM_HOMESERVER }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errcode: "M_UNRECOGNIZED",
      error: "Unrecognized request",
    });
  });
});
