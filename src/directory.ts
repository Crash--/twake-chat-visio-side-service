import { Client, EqualityFilter } from "ldapts";

import { UPSTREAM_TIMEOUT_MS, UpstreamError } from "./upstream.ts";

export interface DirectorySettings {
  url: string;
  base: string;
  bindDn: string | null;
  bindPassword: string;
  uidAttribute: string;
}

/** What Meet needs of a user and the directory knows. */
export interface DirectoryEntry {
  /** Meet finds its user by email: the homeserver may hold none. */
  email: string | null;
  /** The Twake Workplace instance of the user, where Meet saves the recordings. */
  twakeInstance: string | null;
}

/** An attribute with one value, or none when it has several. */
function single(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];

  return values.length === 1 && typeof values[0] === "string" && values[0] ? values[0] : null;
}

/** The LDAP directory of the Twake Workplace, where each Matrix user is the entry of its localpart. */
export class Directory {
  #settings: DirectorySettings;

  constructor(settings: DirectorySettings) {
    this.#settings = settings;
  }

  async entry(uid: string): Promise<DirectoryEntry> {
    const { url, base, bindDn, bindPassword, uidAttribute } = this.#settings;
    const client = new Client({ url, timeout: UPSTREAM_TIMEOUT_MS, connectTimeout: UPSTREAM_TIMEOUT_MS });
    try {
      if (bindDn) {
        await client.bind(bindDn, bindPassword);
      }
      const { searchEntries } = await client.search(base, {
        scope: "sub",
        filter: new EqualityFilter({ attribute: uidAttribute, value: uid }),
        attributes: ["mail", "twakeWorkspaceUrl", "workspaceurl"],
      });
      const [entry] = searchEntries.length === 1 ? searchEntries : [];

      return {
        email: single(entry?.mail)?.toLowerCase() ?? null,
        // `workspaceurl` is the older name of `twakeWorkspaceUrl`
        twakeInstance: single(entry?.twakeWorkspaceUrl) ?? single(entry?.workspaceurl),
      };
    } catch (err) {
      throw new UpstreamError("directory", err instanceof Error ? err.message : String(err));
    } finally {
      await client.unbind().catch(() => null);
    }
  }
}
