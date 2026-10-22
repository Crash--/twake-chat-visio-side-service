import { readConfig } from "./config.ts";
import { makeHandler } from "./server.ts";

const config = readConfig();
const server = Bun.serve({
  port: config.port,
  fetch: makeHandler(config),
});
console.log(`listening on ${server.url}`);

process.on("SIGTERM", () => {
  void server.stop();
});
