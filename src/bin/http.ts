import { loadConfig } from "../config.ts";
import { createHttpServer } from "../http.ts";
import { SessionStore } from "../store.ts";

const config = loadConfig();
const store = SessionStore.open(config.dbPath, { readOnly: true });
const server = createHttpServer(store, { token: config.token });

server.listen(config.port, config.host, () => {
  console.log(`session-gateway listening on http://${config.host}:${config.port}/mcp (db: ${config.dbPath})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
