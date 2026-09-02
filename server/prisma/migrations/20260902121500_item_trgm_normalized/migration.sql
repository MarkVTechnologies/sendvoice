-- Follow-up to 20260902120000_item_catalogue: the trigram index was built
-- on "description" (original casing), but search compares against
-- lowercased query input — trigram similarity is case-sensitive, so that
-- index would never actually get used for a case-insensitive match. Index
-- "normalizedDescription" instead, which is already lowercased.
DROP INDEX IF EXISTS "Item_description_trgm_idx";
CREATE INDEX "Item_normalizedDescription_trgm_idx" ON "Item" USING gin ("normalizedDescription" gin_trgm_ops);
