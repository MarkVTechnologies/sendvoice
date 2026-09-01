-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'VIEWER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('QUOTE', 'PROFORMA', 'INVOICE', 'CREDIT_NOTE', 'RECEIPT', 'DELIVERY_NOTE', 'STATEMENT');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('ITEM', 'SERVICE', 'LABOUR', 'EXPENSE', 'DISCOUNT', 'DEPOSIT', 'SUBTOTAL_HEADER');

-- CreateEnum
CREATE TYPE "DeliveryRail" AS ENUM ('RAIL_A_ASSISTED', 'RAIL_B_DIRECT', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "taxId" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "notes" TEXT,
    "optedInAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSeries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "number" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "taxProfileId" TEXT,
    "taxProfileVersion" INTEGER,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "convertedFromId" TEXT,
    "pdfUrl" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "LineType" NOT NULL DEFAULT 'ITEM',
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,3),
    "unit" TEXT,
    "rate" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2),
    "taxCode" TEXT,
    "imageUrl" TEXT,
    "note" TEXT,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rail" "DeliveryRail" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "templateId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "provider" TEXT,
    "reference" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WabaConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "qualityRating" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "connectedAt" TIMESTAMP(3),

    CONSTRAINT "WabaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WabaTemplate" (
    "id" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WabaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendCostLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientCountry" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "costMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendCostLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_whatsapp_idx" ON "Customer"("tenantId", "whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_tenantId_docType_year_key" ON "NumberSeries"("tenantId", "docType", "year");

-- CreateIndex
CREATE INDEX "TaxProfile_tenantId_idx" ON "TaxProfile"("tenantId");

-- CreateIndex
CREATE INDEX "Document_tenantId_status_idx" ON "Document"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Document_tenantId_customerId_idx" ON "Document"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_docType_number_key" ON "Document"("tenantId", "docType", "number");

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_idx" ON "DocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "DocumentEvent_documentId_idx" ON "DocumentEvent"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_idempotencyKey_key" ON "Delivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Delivery_documentId_idx" ON "Delivery"("documentId");

-- CreateIndex
CREATE INDEX "Payment_documentId_idx" ON "Payment"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "WabaConnection_tenantId_key" ON "WabaConnection"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WabaTemplate_wabaId_name_key" ON "WabaTemplate"("wabaId", "name");

-- CreateIndex
CREATE INDEX "PaymentProviderLink_tenantId_idx" ON "PaymentProviderLink"("tenantId");

-- CreateIndex
CREATE INDEX "SendCostLedgerEntry_tenantId_occurredAt_idx" ON "SendCostLedgerEntry"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEvent" ADD CONSTRAINT "DocumentEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WabaConnection" ADD CONSTRAINT "WabaConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WabaTemplate" ADD CONSTRAINT "WabaTemplate_wabaId_fkey" FOREIGN KEY ("wabaId") REFERENCES "WabaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderLink" ADD CONSTRAINT "PaymentProviderLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
