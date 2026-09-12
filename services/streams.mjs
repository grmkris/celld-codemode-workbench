import { mkdirSync } from "node:fs";
import { DurableStreamTestServer } from "@durable-streams/server";

const port = Number(process.env.STREAMS_PORT ?? 4437);
const host = "127.0.0.1";
const dataDir = process.env.STREAMS_DATA_DIR ?? "/tmp/celld-streams-data";

mkdirSync(dataDir, { recursive: true });

const server = new DurableStreamTestServer({ port, host, dataDir });
const url = await server.start();
console.log(JSON.stringify({ ok: true, url }));

async function shutdown() {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
