-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('calcom', 'ghl', 'retell', 'anthropic');

-- CreateEnum
CREATE TYPE "DegradationMode" AS ENUM ('message', 'callback');

-- CreateEnum
CREATE TYPE "LanguageMismatchAction" AS ENUM ('message_take', 'generic_fallback', 'hang_up');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('completed', 'interrupted', 'failed', 'no_answer');

-- CreateEnum
CREATE TYPE "LastStep" AS ENUM ('greeting', 'intent_detection', 'availability_check', 'booking', 'cancellation', 'rescheduling', 'message_taking', 'emergency', 'followup', 'closing');

-- CreateEnum
CREATE TYPE "PostProcessingStatus" AS ENUM ('pending', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "CrmWriteStatus" AS ENUM ('success', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "operating_hours" JSONB NOT NULL,
    "greeting_text" TEXT NOT NULL,
    "closing_text" TEXT NOT NULL,
    "filler_speech" TEXT NOT NULL,
    "fallback_message" TEXT NOT NULL,
    "degradation_mode" "DegradationMode" NOT NULL,
    "language_mismatch_action" "LanguageMismatchAction" NOT NULL,
    "urgent_escalation_config" JSONB NOT NULL,
    "phone_number" TEXT NOT NULL,
    "retell_agent_id" TEXT NOT NULL,
    "kb_reference" TEXT,
    "enabled_intents" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "integration_type" "IntegrationType" NOT NULL,
    "config_json" JSONB NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "caller_phone" TEXT NOT NULL,
    "raw_phone" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "disposition" "Disposition",
    "last_step" "LastStep",
    "detected_intent" TEXT,
    "raw_transcript" TEXT,
    "opus_summary" TEXT,
    "booking_id" TEXT,
    "message_text" TEXT,
    "post_processing_status" "PostProcessingStatus" NOT NULL DEFAULT 'pending',
    "opus_failure_reason" TEXT,
    "orphaned_booking_flag" BOOLEAN NOT NULL DEFAULT false,
    "crm_write_status" "CrmWriteStatus" NOT NULL DEFAULT 'skipped',
    "ghl_note_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caller_memory" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "caller_phone" TEXT NOT NULL,
    "raw_phone" TEXT,
    "caller_name" TEXT,
    "last_call_id" TEXT,
    "last_call_at" TIMESTAMP(3),
    "recent_appointment_status" TEXT,
    "recent_message_summary" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caller_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_call_id_key" ON "call_logs"("call_id");

-- CreateIndex
CREATE INDEX "idx_call_logs_business_created" ON "call_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_call_logs_business_phone" ON "call_logs"("business_id", "caller_phone");

-- CreateIndex
CREATE UNIQUE INDEX "uq_caller_memory_business_phone" ON "caller_memory"("business_id", "caller_phone");

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caller_memory" ADD CONSTRAINT "caller_memory_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caller_memory" ADD CONSTRAINT "caller_memory_last_call_id_fkey" FOREIGN KEY ("last_call_id") REFERENCES "call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
