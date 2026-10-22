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

export function makeHandler(config: Pick<Config, "hsToken">): (request: Request) => Response {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && (pathname === "/health/live" || pathname === "/health/ready")) {
      return Response.json({
        status: "ok",
      });
    }
    if (!isFromHomeserver(request, config.hsToken)) {
      // Synapse hands this answer to the client as is: a 401 would read there as a revoked access token
      return matrixError(403, "M_FORBIDDEN", "Not authenticated by the homeserver");
    }

    return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
  };
}
