import type { DirectorySettings } from "./directory.ts";
import type { MeetSettings } from "./meet.ts";

export interface Config {
  port: number;
  hsToken: string;
  asToken: string;
  homeserverUrl: string;
  livekitUrl: string;
  databaseUrl: string;
  meet: MeetSettings;
  ldap: DirectorySettings;
}

type Env = Record<string, string | undefined>;

export function readConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) {
      missing.push(name);
    }

    return value ?? "";
  };
  const config = {
    port: Number(env.PORT || 8080),
    hsToken: required("HS_TOKEN"),
    asToken: required("AS_TOKEN"),
    homeserverUrl: required("HOMESERVER_URL"),
    livekitUrl: required("LIVEKIT_URL"),
    databaseUrl: required("DATABASE_URL"),
    meet: {
      url: required("MEET_URL"),
      clientId: required("MEET_CLIENT_ID"),
      clientSecret: required("MEET_CLIENT_SECRET"),
      serviceAccountEmail: required("MEET_SERVICE_ACCOUNT_EMAIL"),
    },
    ldap: {
      url: required("LDAP_URL"),
      base: required("LDAP_BASE"),
      bindDn: env.LDAP_BIND_DN || null,
      // A DN without a password binds anonymously, silently (RFC 4513)
      bindPassword: env.LDAP_BIND_DN ? required("LDAP_BIND_PASSWORD") : "",
      uidAttribute: env.LDAP_UID_ATTRIBUTE || "uid",
    },
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return config;
}
