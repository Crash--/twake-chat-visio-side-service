import { createHash, timingSafeEqual } from "node:crypto";

import type { Config } from "./config.ts";

export function matrixError(status: number, errcode: string, error: string): Response {
  return Response.json(
    {
      errcode,
      error,
    },
    {
      status,
    },
  );
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Synapse sends the `hs_token` of the registration with every request it relays (MSC4512). */
function isFromHomeserver(request: Request, hsToken: string): boolean {
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${hsToken}`));
}

export interface Deps {
  /** Whether the database answers: the calls need it. */
  isReady(): Promise<boolean>;
}

const health = (ok: boolean): Response =>
  Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503 });

export function makeHandler(config: Pick<Config, "hsToken">, deps: Deps): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health/live") {
      return health(true);
    }
    if (request.method === "GET" && pathname === "/health/ready") {
      return health(await deps.isReady());
    }
    if (!isFromHomeserver(request, config.hsToken)) {
      // Synapse hands this answer to the client as is: a 401 would read there as a revoked access token
      return matrixError(403, "M_FORBIDDEN", "Not authenticated by the homeserver");
    }

    return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
  };
}
