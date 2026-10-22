import { createHash, timingSafeEqual } from "node:crypto";

import { SQL } from "bun";

import type { Config } from "./config.ts";
import { log } from "./log.ts";
import { RefusedError, UpstreamError } from "./upstream.ts";

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
  getToken(request: Request): Promise<Response>;
}

const health = (ok: boolean): Response =>
  Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503 });

/** The client API only: the federation twin of the route, which Synapse relays too, is not served. */
const GET_TOKEN_PATH = /^\/_matrix\/client\/(?:v1|unstable\/[^/]+)\/rtc\/livekit\/get_token$/;

/** Synapse gives up on the service after 30 s: answer before, whatever is still pending. */
const DEADLINE_MS = 25_000;

function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: Timer | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamError("deadline", `no answer within ${deadlineMs} ms`)), deadlineMs);
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function served(request: Request, deps: Deps, deadlineMs: number): Promise<Response> {
  try {
    return await withDeadline(deps.getToken(request), deadlineMs);
  } catch (err) {
    if (err instanceof RefusedError) {
      log("info", "token refused", { reason: err.message });

      return matrixError(403, "M_FORBIDDEN", err.message);
    }
    if (err instanceof UpstreamError || err instanceof SQL.SQLError) {
      log("warn", "upstream failure", { reason: err.message });

      return matrixError(502, "M_UNKNOWN", "A service the call depends on failed");
    }
    log("warn", "internal error", { reason: err instanceof Error ? (err.stack ?? err.message) : String(err) });

    return matrixError(500, "M_UNKNOWN", "Internal error");
  }
}

export function makeHandler(
  config: Pick<Config, "hsToken">,
  deps: Deps,
  deadlineMs = DEADLINE_MS,
): (request: Request) => Promise<Response> {
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
    if (request.method === "POST" && GET_TOKEN_PATH.test(pathname)) {
      return served(request, deps, deadlineMs);
    }

    return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
  };
}
