import { describe, expect, mock, test } from "bun:test";

import { SQL } from "bun";

import { makeHandler } from "./server.ts";
import { RefusedError, UpstreamError } from "./upstream.ts";

let ready = true;
const getToken = mock(() => Promise.resolve(Response.json({ jwt: "the-jwt" })));
const handle = makeHandler({ hsToken: "hs-secret" }, { isReady: () => Promise.resolve(ready), getToken });
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

  test("serves get_token on the stable and the unstable path of the client API", async () => {
    for (const path of ["v1", "unstable/io.element.msc4195"]) {
      const url = `http://service/_matrix/client/${path}/rtc/livekit/get_token`;
      const response = await handle(new Request(url, { method: "POST", headers: FROM_HOMESERVER }));

      expect(await response.json()).toEqual({ jwt: "the-jwt" });
    }
  });

  test("does not serve the federation twin of get_token, nor a GET", async () => {
    getToken.mockClear();
    const federation = "http://service/_matrix/federation/v1/rtc/livekit/get_token";

    expect((await handle(new Request(federation, { method: "POST", headers: FROM_HOMESERVER }))).status).toBe(404);
    expect((await handle(new Request(GET_TOKEN, { headers: FROM_HOMESERVER }))).status).toBe(404);
    expect(getToken).not.toHaveBeenCalled();
  });

  test("answers 502 when a service the call depends on fails, 500 otherwise", async () => {
    const post = (): Promise<Response> => handle(new Request(GET_TOKEN, { method: "POST", headers: FROM_HOMESERVER }));
    getToken.mockImplementationOnce(() => Promise.reject(new UpstreamError("meet", "down")));
    const upstream = await post();
    getToken.mockImplementationOnce(() => Promise.reject(new Error("bug")));
    const internal = await post();

    expect([upstream.status, await upstream.json()]).toEqual([
      502,
      { errcode: "M_UNKNOWN", error: "A service the call depends on failed" },
    ]);
    expect([internal.status, await internal.json()]).toEqual([500, { errcode: "M_UNKNOWN", error: "Internal error" }]);
  });

  test("answers 502 when the database fails", async () => {
    getToken.mockImplementationOnce(() => Promise.reject(new SQL.PostgresError("Failed to connect", {} as never)));
    const response = await handle(new Request(GET_TOKEN, { method: "POST", headers: FROM_HOMESERVER }));

    expect(response.status).toBe(502);
  });

  test("answers 403 when Meet refuses the user", async () => {
    getToken.mockImplementationOnce(() => Promise.reject(new RefusedError("Meet refuses to act for this user (403)")));
    const response = await handle(new Request(GET_TOKEN, { method: "POST", headers: FROM_HOMESERVER }));

    expect([response.status, await response.json()]).toEqual([
      403,
      { errcode: "M_FORBIDDEN", error: "Meet refuses to act for this user (403)" },
    ]);
  });

  test("answers 502 before the homeserver gives up", async () => {
    const slow = makeHandler(
      { hsToken: "hs-secret" },
      { isReady: () => Promise.resolve(true), getToken: () => new Promise<never>(() => undefined) },
      20,
    );
    const response = await slow(new Request(GET_TOKEN, { method: "POST", headers: FROM_HOMESERVER }));

    expect(response.status).toBe(502);
  });
});
