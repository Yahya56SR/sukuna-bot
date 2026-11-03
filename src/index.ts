import { SukunaClient } from "./client";

const client = new SukunaClient();

client.start().catch((error) => {
  console.error("[Fatal] Failed to start bot:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("[UnhandledRejection]", reason);
});

process.on("uncaughtException", (error: any) => {
  console.error("[UncaughtException]", error);
  process.exit(1);
});
