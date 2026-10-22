import { SQL } from "bun";

import { CallRooms } from "./call-rooms.ts";
import { readConfig } from "./config.ts";
import { Directory } from "./directory.ts";
import { getToken, type TokenDeps } from "./get-token.ts";
import { Homeserver } from "./homeserver.ts";
import { Meet } from "./meet.ts";
import { makeHandler } from "./server.ts";

const config = readConfig();
const sql = new SQL(config.databaseUrl, { connectionTimeout: 5 });
const callRooms = new CallRooms(sql);
await callRooms.migrate();
const tokenDeps: TokenDeps = {
  livekitUrl: config.livekitUrl,
  homeserver: new Homeserver(config.homeserverUrl, config.asToken),
  directory: new Directory(config.ldap),
  meet: new Meet(config.meet),
  callRooms,
};

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
    getToken: (request) => getToken(request, tokenDeps),
  }),
});
console.log(`listening on ${server.url}`);

process.on("SIGTERM", () => {
  void server.stop().then(() => sql.close());
});
