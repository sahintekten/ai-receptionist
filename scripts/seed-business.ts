import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

const prisma = new PrismaClient();

interface SeedConfig {
  business: {
    name: string;
    language: string;
    timezone: string;
    phoneNumber: string;
    retellAgentId: string;
    kbReference: string;
    greetingText: string;
    closingText: string;
    fillerSpeech: string;
    fallbackMessage: string;
    degradationMode: "message" | "callback";
    languageMismatchAction: "message_take" | "generic_fallback" | "hang_up";
    operatingHours: Record<string, Array<{ open: string; close: string }>>;
    urgentEscalationConfig: Record<string, unknown>;
    enabledIntents: string[];
  };
  integrations: {
    calcom: Record<string, unknown>;
    twenty: { api_key: string };
    retell: Record<string, unknown>;
    anthropic: Record<string, unknown>;
  };
}

async function seed() {
  const configPath = process.argv[2] || resolve(__dirname, "seed-tekten.json");
  console.log(`Reading config from: ${configPath}`);

  const raw = readFileSync(configPath, "utf-8");
  const config: SeedConfig = JSON.parse(raw);

  // Resolve "FROM_ENV" placeholders
  if (config.integrations.twenty.api_key === "FROM_ENV") {
    const key = process.env.TWENTY_API_KEY;
    if (!key) {
      console.error("ERROR: TWENTY_API_KEY env var required when twenty.api_key is FROM_ENV");
      process.exit(1);
    }
    config.integrations.twenty.api_key = key;
  }

  const biz = config.business;

  console.log(`\nSeeding business: ${biz.name}`);

  // Upsert business (idempotent by retell_agent_id)
  const existing = await prisma.business.findFirst({
    where: { retellAgentId: biz.retellAgentId },
  });

  let businessId: string;

  if (existing) {
    console.log(`Business '${biz.name}' already exists (id: ${existing.id}), updating...`);
    await prisma.business.update({
      where: { id: existing.id },
      data: {
        name: biz.name,
        language: biz.language,
        timezone: biz.timezone,
        phoneNumber: biz.phoneNumber,
        kbReference: biz.kbReference,
        greetingText: biz.greetingText,
        closingText: biz.closingText,
        fillerSpeech: biz.fillerSpeech,
        fallbackMessage: biz.fallbackMessage,
        degradationMode: biz.degradationMode,
        languageMismatchAction: biz.languageMismatchAction,
        operatingHours: biz.operatingHours,
        urgentEscalationConfig: biz.urgentEscalationConfig,
        enabledIntents: biz.enabledIntents,
        isActive: true,
      },
    });
    businessId = existing.id;
  } else {
    console.log(`Creating new business '${biz.name}'...`);
    const created = await prisma.business.create({
      data: {
        name: biz.name,
        language: biz.language,
        timezone: biz.timezone,
        phoneNumber: biz.phoneNumber,
        retellAgentId: biz.retellAgentId,
        kbReference: biz.kbReference,
        greetingText: biz.greetingText,
        closingText: biz.closingText,
        fillerSpeech: biz.fillerSpeech,
        fallbackMessage: biz.fallbackMessage,
        degradationMode: biz.degradationMode,
        languageMismatchAction: biz.languageMismatchAction,
        operatingHours: biz.operatingHours,
        urgentEscalationConfig: biz.urgentEscalationConfig,
        enabledIntents: biz.enabledIntents,
        isActive: true,
      },
    });
    businessId = created.id;
  }

  console.log(`Business ID: ${businessId}`);

  // Upsert integration configs
  const integrationTypes = [
    { type: "calcom" as const, config: config.integrations.calcom },
    { type: "twenty" as const, config: config.integrations.twenty },
    { type: "retell" as const, config: config.integrations.retell },
    { type: "anthropic" as const, config: config.integrations.anthropic },
  ];

  for (const { type, config: configJson } of integrationTypes) {
    const existingIntegration = await prisma.integrationConfig.findFirst({
      where: { businessId, integrationType: type },
    });

    if (existingIntegration) {
      await prisma.integrationConfig.update({
        where: { id: existingIntegration.id },
        data: { configJson, isEnabled: true },
      });
      console.log(`  Updated ${type} integration config`);
    } else {
      await prisma.integrationConfig.create({
        data: {
          businessId,
          integrationType: type,
          configJson,
          isEnabled: true,
        },
      });
      console.log(`  Created ${type} integration config`);
    }
  }

  // Run validation
  console.log("\nRunning config validation...");
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { integrationConfigs: true },
  });

  if (!business) {
    console.error("ERROR: Business not found after seed");
    process.exit(1);
  }

  const errors: string[] = [];
  if (!business.retellAgentId) errors.push("retell_agent_id missing");
  if (!business.phoneNumber) errors.push("phone_number missing");
  if (!business.language) errors.push("language missing");
  if (!business.timezone) errors.push("timezone missing");
  if (!business.kbReference) errors.push("kb_reference missing");

  const calcom = business.integrationConfigs.find((i) => i.integrationType === "calcom");
  if (!calcom) errors.push("Cal.com integration missing");

  const twenty = business.integrationConfigs.find((i) => i.integrationType === "twenty");
  if (!twenty) errors.push("Twenty integration missing");
  else {
    const tConfig = twenty.configJson as Record<string, unknown>;
    if (!tConfig.api_key) errors.push("Twenty api_key missing");
  }

  if (errors.length > 0) {
    console.error("\nValidation FAILED:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log("\nValidation PASSED");
  console.log(`\nSeed complete: ${biz.name} (${businessId})`);
  console.log(`  Agent: ${biz.retellAgentId}`);
  console.log(`  Phone: ${biz.phoneNumber}`);
  console.log(`  Language: ${biz.language}`);
  console.log(`  Integrations: ${integrationTypes.map((i) => i.type).join(", ")}`);
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
