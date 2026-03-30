import Anthropic from "@anthropic-ai/sdk";
import { IntegrationError } from "../lib/errors";
import { logger } from "../lib/logger";

const TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `Sen bir klinik arama analiz asistanısın. Aşağıdaki telefon görüşmesi transkriptini analiz et.

Görevin:
1. Aramanın kısa özeti (2-3 cümle, Türkçe)
2. CRM için detaylı not (markdown formatında, Türkçe) — arayanın talebi, yapılan işlem, sonuç, önemli notlar
3. Orphaned booking kontrolü — arama kesildi mi VE randevu talebi gönderildi ama arayana onay verilmedi mi?

JSON formatında yanıt ver:
{
  "summary": "...",
  "enrichedNote": "...",
  "orphanedBookingFlag": true/false,
  "orphanedBookingDetails": "..." // sadece flag true ise
}`;

export interface PostCallMetadata {
  businessName: string;
  callerPhone: string;
  disposition: string;
  detectedIntent?: string;
  bookingId?: string;
  durationSeconds?: number;
}

export interface PostCallResult {
  summary: string;
  enrichedNote: string;
  orphanedBookingFlag: boolean;
  orphanedBookingDetails?: string;
}

export interface ModelConfig {
  model_id?: string;
  max_tokens?: number;
  temperature?: number;
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === "placeholder") {
    throw new IntegrationError("Anthropic", "ANTHROPIC_API_KEY not configured");
  }
  return key;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context?: { call_id?: string; business_id?: string; action?: string }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Anthropic retry attempt", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: "retrying",
      error: error instanceof Error ? error.message : String(error),
    });
    return await fn();
  }
}

export async function generatePostCallSummary(
  transcript: string,
  metadata: PostCallMetadata,
  modelConfig: ModelConfig = {},
  context?: { call_id?: string; business_id?: string }
): Promise<PostCallResult> {
  const ctx = { ...context, action: "opus_generate_summary" };
  const startTime = Date.now();

  const client = new Anthropic({ apiKey: getApiKey() });
  const model = modelConfig.model_id || "claude-sonnet-4-20250514";
  const maxTokens = modelConfig.max_tokens || 1024;
  const temperature = modelConfig.temperature || 0.3;

  const userMessage = `Arama bilgileri:
- İşletme: ${metadata.businessName}
- Arayan: ${metadata.callerPhone}
- Durum: ${metadata.disposition}
- Süre: ${metadata.durationSeconds ? `${metadata.durationSeconds} saniye` : "bilinmiyor"}
${metadata.detectedIntent ? `- Tespit edilen niyet: ${metadata.detectedIntent}` : ""}
${metadata.bookingId ? `- Randevu ID: ${metadata.bookingId}` : ""}

Transkript:
${transcript}`;

  logger.info("Calling Anthropic API", {
    ...ctx,
    status: "processing",
    model,
  });

  const result = await withRetry(async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const durationMs = Date.now() - startTime;

    // Extract text content
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new IntegrationError("Anthropic", "No text response from Opus");
    }

    logger.info("Anthropic API response received", {
      ...ctx,
      status: "ok",
      duration_ms: durationMs,
      model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new IntegrationError("Anthropic", "Could not parse JSON from Opus response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as PostCallResult;
    return parsed;
  }, ctx);

  return result;
}
