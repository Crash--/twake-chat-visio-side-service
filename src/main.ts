import { handle } from "./server.ts";

const server = Bun.serve({
  port: process.env.PORT || 8080,
  fetch: handle,
});
console.log(`listening on ${server.url}`);

process.on("SIGTERM", () => {
  void server.stop();
});
