/*
  Warnings:

  - You are about to drop the column `ghl_note_id` on the `call_logs` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "IntegrationType" ADD VALUE 'twenty';

-- AlterTable
ALTER TABLE "call_logs" DROP COLUMN "ghl_note_id",
ADD COLUMN     "crm_note_id" TEXT;
