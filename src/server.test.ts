import { describe, expect, test } from "bun:test";

import { handle } from "./server.ts";

describe("handle", () => {
  test("answers the probes", async () => {
    for (const path of ["/health/live", "/health/ready"]) {
      const response = handle(new Request(`http://service${path}`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
      });
    }
  });

  test("answers anything else with a Matrix 404", async () => {
    const response = handle(new Request("http://service/elsewhere"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errcode: "M_UNRECOGNIZED",
      error: "Unrecognized request",
    });
  });
});
