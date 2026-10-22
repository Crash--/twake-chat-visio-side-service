import { SQL } from "bun";

import { CallRooms } from "./call-rooms.ts";
import { readConfig } from "./config.ts";
import { makeHandler } from "./server.ts";

const config = readConfig();
const sql = new SQL(config.databaseUrl, { connectionTimeout: 5 });
await new CallRooms(sql).migrate();

const server = Bun.serve({
  port: config.port,
  fetch: makeHandler(config, {
    // A database that holds the connection without answering is not ready either
    isReady: () =>
      Promise.race([
        sql`SELECT 1`.then(
          () => true,
          () => false,
        ),
        Bun.sleep(2000).then(() => false),
      ]),
  }),
});
console.log(`listening on ${server.url}`);

process.on("SIGTERM", () => {
  void server.stop().then(() => sql.close());
});
