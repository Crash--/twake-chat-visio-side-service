import type { SQL } from "bun";

/**
 * The Meet room of each slot of a Matrix room (MSC4195: two slots never share a
 * LiveKit room). Meet names its rooms itself, so the row is the only link from a
 * slot to its call, shared by every replica.
 */
export class CallRooms {
  #sql: SQL;

  constructor(sql: SQL) {
    this.#sql = sql;
  }

  /** Creates the table; replicas starting together wait for each other instead of racing on it. */
  async migrate(): Promise<void> {
    await this.#sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('call_rooms', 0))`;
      await tx`CREATE TABLE IF NOT EXISTS call_rooms (
        matrix_room_id text NOT NULL,
        slot_id text NOT NULL,
        meet_room_id text NOT NULL,
        PRIMARY KEY (matrix_room_id, slot_id)
      )`;
    });
  }

  /**
   * The Meet room of the slot, made by `create` when it has none. The lock per slot
   * holds the other replicas until the row is written: never two Meet rooms.
   */
  async ensure(matrixRoomId: string, slotId: string, create: () => Promise<string>): Promise<string> {
    const known = await this.#find(this.#sql, matrixRoomId, slotId);
    if (known) {
      return known;
    }

    // Read committed: the second read must see the row the previous holder of the lock wrote
    return this.#sql.begin("isolation level read committed", async (tx) => {
      // The holder waits for Meet (two calls of 5 s at most): the others give up after that
      await tx`SET LOCAL lock_timeout = '12s'`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([matrixRoomId, slotId])}, 0))`;
      const madeMeanwhile = await this.#find(tx, matrixRoomId, slotId);
      if (madeMeanwhile) {
        return madeMeanwhile;
      }
      const meetRoomId = await create();
      await tx`INSERT INTO call_rooms (matrix_room_id, slot_id, meet_room_id)
        VALUES (${matrixRoomId}, ${slotId}, ${meetRoomId})`;

      return meetRoomId;
    });
  }

  /** Drops the link only while it still holds this Meet room: another replica may have replaced it. */
  async forget(matrixRoomId: string, slotId: string, meetRoomId: string): Promise<void> {
    await this.#sql`DELETE FROM call_rooms
      WHERE matrix_room_id = ${matrixRoomId} AND slot_id = ${slotId} AND meet_room_id = ${meetRoomId}`;
  }

  async #find(sql: SQL, matrixRoomId: string, slotId: string): Promise<string | null> {
    const [row] = await sql`SELECT meet_room_id FROM call_rooms
      WHERE matrix_room_id = ${matrixRoomId} AND slot_id = ${slotId}`;

    return row?.meet_room_id ?? null;
  }
}
