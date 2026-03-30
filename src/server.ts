import "dotenv/config";
import express from "express";
import { prisma, disconnectPrisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import retellRouter from "./routes/retell";
import webhookRouter from "./routes/webhook";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());

// Health check — verifies DB connectivity
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error("Health check failed", {
      action: "health_check",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ status: "error", message: "Database connection failed" });
  }
});

app.use("/retell", retellRouter);
app.use("/webhook", webhookRouter);

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`, {
    action: "server_start",
    status: "ok",
  });
});

// Graceful shutdown — drain in-flight requests
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`, {
    action: "shutdown",
    status: "draining",
  });

  server.close(async () => {
    logger.info("HTTP server closed", { action: "shutdown", status: "http_closed" });
    await disconnectPrisma();
    logger.info("Prisma disconnected", { action: "shutdown", status: "complete" });
    process.exit(0);
  });

  // Force shutdown after 10s if connections don't drain
  setTimeout(() => {
    logger.error("Forced shutdown after timeout", { action: "shutdown", status: "forced" });
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
