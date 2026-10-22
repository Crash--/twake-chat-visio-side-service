import { describe, expect, test } from "bun:test";

import { readConfig } from "./config.ts";

const REQUIRED = {
  HS_TOKEN: "hs",
  DATABASE_URL: "postgres://db/visio",
};

describe("readConfig", () => {
  test("reads the environment", () => {
    expect(
      readConfig({
        ...REQUIRED,
        PORT: "9000",
      }),
    ).toEqual({
      port: 9000,
      hsToken: "hs",
      databaseUrl: "postgres://db/visio",
    });
  });

  test("listens on 8080 by default", () => {
    expect(readConfig(REQUIRED).port).toBe(8080);
  });

  test("names every missing variable", () => {
    expect(() => readConfig({})).toThrow("Missing environment variables: HS_TOKEN, DATABASE_URL");
  });
});
