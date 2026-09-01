-- Store the rendered PDF in Postgres for now (RLS already protects Document,
-- so this inherits tenant isolation for free). Not real object storage —
-- see the note on Document.pdfData in schema.prisma.
ALTER TABLE "Document" ADD COLUMN "pdfData" BYTEA;
