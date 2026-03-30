import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import type { Business, IntegrationConfig } from "@prisma/client";

interface ValidationError {
  businessId: string;
  businessName: string;
  errors: string[];
}

function validateOperatingHours(hours: unknown): string[] {
  const errors: string[] = [];
  if (!hours || typeof hours !== "object") {
    errors.push("operating_hours is missing or not an object");
    return errors;
  }

  const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const hoursObj = hours as Record<string, unknown>;

  for (const day of validDays) {
    if (!(day in hoursObj)) continue;
    const slots = hoursObj[day];
    if (!Array.isArray(slots)) {
      errors.push(`operating_hours.${day} is not an array`);
      continue;
    }
    for (const slot of slots) {
      if (!slot || typeof slot !== "object" || !("open" in slot) || !("close" in slot)) {
        errors.push(`operating_hours.${day} has invalid slot format (expected {open, close})`);
      }
    }
  }

  return errors;
}

function validateBusiness(
  business: Business,
  integrations: IntegrationConfig[],
  allAgentIds: Map<string, string>,
  allPhoneNumbers: Map<string, string>
): string[] {
  const errors: string[] = [];

  // Agent ID mapped and not duplicate
  if (!business.retellAgentId) {
    errors.push("retell_agent_id is missing");
  } else {
    const existingBusiness = allAgentIds.get(business.retellAgentId);
    if (existingBusiness && existingBusiness !== business.id) {
      errors.push(`retell_agent_id '${business.retellAgentId}' is duplicate (also used by business ${existingBusiness})`);
    }
  }

  // Phone number mapped and not duplicate
  if (!business.phoneNumber) {
    errors.push("phone_number is missing");
  } else {
    const existingBusiness = allPhoneNumbers.get(business.phoneNumber);
    if (existingBusiness && existingBusiness !== business.id) {
      errors.push(`phone_number '${business.phoneNumber}' is duplicate (also used by business ${existingBusiness})`);
    }
  }

  // Language defined
  if (!business.language) errors.push("language is missing");

  // Timezone defined
  if (!business.timezone) errors.push("timezone is missing");

  // KB reference
  if (!business.kbReference) errors.push("kb_reference is missing");

  // Operating hours format
  errors.push(...validateOperatingHours(business.operatingHours));

  // Fallback behavior
  if (!business.degradationMode) errors.push("degradation_mode is missing");
  if (!business.fallbackMessage) errors.push("fallback_message is missing");
  if (!business.greetingText) errors.push("greeting_text is missing");
  if (!business.closingText) errors.push("closing_text is missing");

  // Integration configs
  const calcom = integrations.find((i) => i.integrationType === "calcom" && i.isEnabled);
  const twenty = integrations.find((i) => i.integrationType === "twenty" && i.isEnabled);

  // Cal.com event types
  if (!calcom) {
    errors.push("Cal.com integration config missing or disabled");
  } else {
    const config = calcom.configJson as Record<string, unknown>;
    const eventTypes = config.event_types;
    if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      errors.push("Cal.com event_types is empty or missing");
    }
  }

  // Twenty API key
  if (!twenty) {
    errors.push("Twenty CRM integration config missing or disabled");
  } else {
    const config = twenty.configJson as Record<string, unknown>;
    if (!config.api_key) {
      errors.push("Twenty CRM api_key is missing in config");
    }
  }

  return errors;
}

export async function validateAllBusinesses(): Promise<{
  valid: number;
  invalid: number;
  errors: ValidationError[];
}> {
  const businesses = await prisma.business.findMany({
    include: { integrationConfigs: true },
  });

  const allAgentIds = new Map<string, string>();
  const allPhoneNumbers = new Map<string, string>();

  // First pass: collect agent IDs and phone numbers for duplicate detection
  for (const business of businesses) {
    if (business.retellAgentId) {
      allAgentIds.set(business.retellAgentId, business.id);
    }
    if (business.phoneNumber) {
      allPhoneNumbers.set(business.phoneNumber, business.id);
    }
  }

  const validationErrors: ValidationError[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const business of businesses) {
    const errors = validateBusiness(
      business,
      business.integrationConfigs,
      allAgentIds,
      allPhoneNumbers
    );

    if (errors.length > 0) {
      invalidCount++;
      validationErrors.push({
        businessId: business.id,
        businessName: business.name,
        errors,
      });

      // Deactivate invalid business
      if (business.isActive) {
        await prisma.business.update({
          where: { id: business.id },
          data: { isActive: false },
        });
        logger.warn(`Business '${business.name}' deactivated due to config errors`, {
          business_id: business.id,
          action: "config_validation",
          status: "deactivated",
          errors,
        });
      }
    } else {
      validCount++;
      logger.info(`Business '${business.name}' config valid`, {
        business_id: business.id,
        action: "config_validation",
        status: "valid",
      });
    }
  }

  logger.info("Config validation complete", {
    action: "config_validation",
    status: "complete",
    valid: validCount,
    invalid: invalidCount,
    total: businesses.length,
  });

  return { valid: validCount, invalid: invalidCount, errors: validationErrors };
}
