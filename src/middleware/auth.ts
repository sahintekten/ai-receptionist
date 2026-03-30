import type { Request, Response, NextFunction } from "express";
import Retell from "retell-sdk";
import { logger } from "../lib/logger";

export async function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const signature = req.headers["x-retell-signature"] as string | undefined;

  if (!signature) {
    logger.warn("Missing X-Retell-Signature header", {
      action: "webhook_auth",
      status: "missing_signature",
    });
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    logger.error("RETELL_API_KEY not configured", {
      action: "webhook_auth",
      status: "config_error",
    });
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Retell.verify expects the raw body string
  const rawBody = JSON.stringify(req.body);

  try {
    const isValid = await Retell.verify(rawBody, apiKey, signature);
    if (!isValid) {
      logger.warn("Invalid webhook signature", {
        action: "webhook_auth",
        status: "invalid_signature",
      });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch (error) {
    logger.error("Webhook signature verification error", {
      action: "webhook_auth",
      status: "verification_error",
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(401).json({ error: "Signature verification failed" });
    return;
  }

  next();
}
