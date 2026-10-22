import { describe, expect, test } from "bun:test";

import { readConfig } from "./config.ts";

const REQUIRED = {
  HS_TOKEN: "hs",
  AS_TOKEN: "as",
  HOMESERVER_URL: "http://synapse:8008",
  LIVEKIT_URL: "wss://livekit.example.org",
  DATABASE_URL: "postgres://db/visio",
  MEET_URL: "https://meet.example.org",
  MEET_CLIENT_ID: "chat",
  MEET_CLIENT_SECRET: "meet-secret",
  MEET_SERVICE_ACCOUNT_EMAIL: "calls@example.org",
  LDAP_URL: "ldap://ldap",
  LDAP_BASE: "ou=users,dc=example,dc=org",
};

describe("readConfig", () => {
  test("reads the environment", () => {
    expect(
      readConfig({
        ...REQUIRED,
        PORT: "9000",
        LDAP_BIND_DN: "cn=admin,dc=example,dc=org",
        LDAP_BIND_PASSWORD: "ldap-secret",
        LDAP_UID_ATTRIBUTE: "cn",
      }),
    ).toEqual({
      port: 9000,
      hsToken: "hs",
      asToken: "as",
      homeserverUrl: "http://synapse:8008",
      livekitUrl: "wss://livekit.example.org",
      databaseUrl: "postgres://db/visio",
      meet: {
        url: "https://meet.example.org",
        clientId: "chat",
        clientSecret: "meet-secret",
        serviceAccountEmail: "calls@example.org",
      },
      ldap: {
        url: "ldap://ldap",
        base: "ou=users,dc=example,dc=org",
        bindDn: "cn=admin,dc=example,dc=org",
        bindPassword: "ldap-secret",
        uidAttribute: "cn",
      },
    });
  });

  test("defaults the port, an anonymous bind and the uid attribute", () => {
    const config = readConfig(REQUIRED);

    expect(config.port).toBe(8080);
    expect(config.ldap).toMatchObject({ bindDn: null, uidAttribute: "uid" });
  });

  test("names every missing variable", () => {
    expect(() => readConfig({ HS_TOKEN: "hs" })).toThrow(
      "Missing environment variables: AS_TOKEN, HOMESERVER_URL, LIVEKIT_URL, DATABASE_URL, MEET_URL, MEET_CLIENT_ID, MEET_CLIENT_SECRET, MEET_SERVICE_ACCOUNT_EMAIL, LDAP_URL, LDAP_BASE",
    );
  });

  test("wants the password of a bind DN", () => {
    expect(() => readConfig({ ...REQUIRED, LDAP_BIND_DN: "cn=admin,dc=example,dc=org" })).toThrow(
      "Missing environment variables: LDAP_BIND_PASSWORD",
    );
  });
});
