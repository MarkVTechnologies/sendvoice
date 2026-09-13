-- PRD §10.1: WabaConnection.signupSessionId lets services/waba.ts poll
-- Telnyx's hosted-signup status endpoint for one specific tenant's session
-- without Telnyx ever needing to know our tenantId.
ALTER TABLE "WabaConnection" ADD COLUMN     "signupSessionId" TEXT;

-- PRD §10.2: WabaTemplate.telnyxTemplateId lets services/waba.ts poll a
-- submitted template's status by Telnyx's own id, independent of our own
-- stable `name`.
ALTER TABLE "WabaTemplate" ADD COLUMN     "telnyxTemplateId" TEXT;
