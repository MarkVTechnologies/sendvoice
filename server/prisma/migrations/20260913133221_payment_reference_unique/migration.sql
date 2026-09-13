-- PRD §9.5 idempotency, applied to PSP payment confirmations the same way
-- it already applies to WhatsApp sends: a Paystack webhook retry and the
-- hosted page's own post-payment redirect can both race to record the
-- identical transaction, and this constraint is what makes the second one
-- a no-op instead of a double payment. Postgres treats NULL as distinct
-- from NULL, so manual cash/bank_transfer payments (both fields null)
-- never collide with each other or with this constraint.
CREATE UNIQUE INDEX "Payment_provider_reference_key" ON "Payment"("provider", "reference");
