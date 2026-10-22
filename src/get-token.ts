import { createHash } from "node:crypto";

import type { CallRooms } from "./call-rooms.ts";
import type { Directory } from "./directory.ts";
import type { Homeserver } from "./homeserver.ts";
import { log } from "./log.ts";
import type { Meet, Participant } from "./meet.ts";
import { matrixError } from "./server.ts";
import { UpstreamError } from "./upstream.ts";

export interface TokenDeps {
  /** The LiveKit of Meet, as `matrix_rtc.transports` of the homeserver announces it. */
  livekitUrl: string;
  homeserver: Pick<Homeserver, "isJoined" | "isModerator" | "displayName">;
  directory: Pick<Directory, "entry">;
  meet: Pick<Meet, "createRoom" | "livekitToken">;
  callRooms: Pick<CallRooms, "ensure" | "forget">;
}

/** Meet takes a `username` of 255 characters at most; a display name can be longer. */
const MAX_USERNAME_LENGTH = 255;
const REQUIRED = ["url", "room_id", "slot_id", "member_id"] as const;

/** MSC4195: `Base64(SHA256(Canonicalize([sender, member.id])))`, unpadded, as every client derives it. */
export function livekitIdentity(userId: string, memberId: string): string {
  // The canonical JSON of an array of two strings is what JSON.stringify writes
  return createHash("sha256")
    .update(JSON.stringify([userId, memberId]))
    .digest("base64")
    .replace(/=+$/, "");
}

const localpart = (userId: string): string => userId.slice(1, userId.indexOf(":"));
const serverName = (userId: string): string => userId.slice(userId.indexOf(":") + 1);
const withoutSlash = (url: string): string => url.replace(/\/+$/, "");

function refuse(status: number, errcode: string, error: string, fields: Record<string, unknown> = {}): Response {
  log("info", "token refused", { reason: error, ...fields });

  return matrixError(status, errcode, error);
}

/**
 * `POST /_matrix/client/v1/rtc/livekit/get_token` (MSC4195), relayed by the homeserver
 * once it authenticated the user. Meet mints the token, in the Meet room of the slot,
 * so that recording and transcription know the participant.
 */
export async function getToken(request: Request, deps: TokenDeps): Promise<Response> {
  const userId = request.headers.get("x-matrix-user-identifier");
  if (!userId?.startsWith("@") || !userId.includes(":")) {
    return refuse(403, "M_FORBIDDEN", "No user: only the client API is served");
  }
  const NOT_JSON = Symbol("not JSON");
  const body: unknown = await request.json().catch(() => NOT_JSON);
  if (body === NOT_JSON) {
    return refuse(400, "M_NOT_JSON", "The body is not JSON", { user: userId });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse(400, "M_BAD_JSON", "The body is not a JSON object", { user: userId });
  }
  const fields = body as Record<string, unknown>;
  for (const name of REQUIRED) {
    if (fields[name] === undefined) {
      return refuse(400, "M_MISSING_PARAM", `${name} is required`, { user: userId });
    }
    if (typeof fields[name] !== "string" || !fields[name]) {
      return refuse(400, "M_INVALID_PARAM", `${name} must be a non-empty string`, { user: userId });
    }
  }
  const {
    url,
    room_id: roomId,
    slot_id: slotId,
    member_id: memberId,
  } = fields as Record<(typeof REQUIRED)[number], string>;
  const room = { user: userId, room: roomId };
  if (fields.server_name !== undefined && typeof fields.server_name !== "string") {
    return refuse(400, "M_INVALID_PARAM", "server_name must be a string", room);
  }
  if (fields.server_name !== undefined && fields.server_name !== serverName(userId)) {
    return refuse(403, "M_FORBIDDEN", "Only the SFU of this homeserver is served", room);
  }
  if (withoutSlash(url) !== withoutSlash(deps.livekitUrl)) {
    return refuse(400, "M_INVALID_PARAM", "url is not the SFU of this homeserver", room);
  }
  if (!roomId.startsWith("!")) {
    return refuse(400, "M_INVALID_PARAM", "room_id is not a room id", room);
  }
  if (!(await deps.homeserver.isJoined(roomId, userId))) {
    return refuse(403, "M_FORBIDDEN", "Not joined to the room", room);
  }

  const [moderator, displayName, entry] = await Promise.all([
    // The role is a refinement: unreadable power levels make a member, not a failed call
    deps.homeserver.isModerator(roomId, userId).catch((err: unknown) => {
      log("warn", "role unknown, joining as a member", { ...room, reason: String(err) });
      return false;
    }),
    deps.homeserver.displayName(userId).catch(() => null),
    deps.directory.entry(localpart(userId)),
  ]);
  if (!entry.email) {
    return refuse(403, "M_FORBIDDEN", "No single email address is known for this user", room);
  }
  const participant: Participant = {
    identity: livekitIdentity(userId, memberId),
    username: [...(displayName ?? localpart(userId))].slice(0, MAX_USERNAME_LENGTH).join(""),
    role: moderator ? "administrator" : "member",
    matrix_user_id: userId,
    matrix_member_id: memberId,
    ...(entry.twakeInstance && { twake_instance: entry.twakeInstance }),
  };

  return Response.json({ jwt: await mint(deps, roomId, slotId, entry.email, participant) });
}

/** The token in the Meet room of the slot; a room Meet no longer has is replaced, once. */
async function mint(
  deps: TokenDeps,
  roomId: string,
  slotId: string,
  email: string,
  participant: Participant,
): Promise<string> {
  const createRoom = (): Promise<string> => deps.meet.createRoom();
  const meetRoomId = await deps.callRooms.ensure(roomId, slotId, createRoom);
  const token = await deps.meet.livekitToken(meetRoomId, email, participant);
  if (token) {
    return token;
  }
  log("warn", "Meet no longer has the room, replacing it", { room: roomId, meetRoom: meetRoomId });
  await deps.callRooms.forget(roomId, slotId, meetRoomId);
  const replaced = await deps.callRooms.ensure(roomId, slotId, createRoom);
  const retried = await deps.meet.livekitToken(replaced, email, participant);
  if (!retried) {
    throw new UpstreamError("meet", `the new room ${replaced} is not found either`);
  }

  return retried;
}
