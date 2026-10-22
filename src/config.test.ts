import { describe, expect, test } from "bun:test";

import { readConfig } from "./config.ts";

describe("readConfig", () => {
  test("reads the environment", () => {
    expect(
      readConfig({
        PORT: "9000",
        HS_TOKEN: "hs",
      }),
    ).toEqual({
      port: 9000,
      hsToken: "hs",
    });
  });

  test("listens on 8080 by default", () => {
    expect(
      readConfig({
        HS_TOKEN: "hs",
      }).port,
    ).toBe(8080);
  });

  test("names every missing variable", () => {
    expect(() => readConfig({})).toThrow("Missing environment variables: HS_TOKEN");
  });
});
