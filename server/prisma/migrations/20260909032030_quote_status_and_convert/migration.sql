-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "DocStatus" ADD VALUE 'DECLINED';

-- DropIndex
DROP INDEX "Item_normalizedDescription_trgm_idx";
