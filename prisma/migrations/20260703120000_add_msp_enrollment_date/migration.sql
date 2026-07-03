ALTER TABLE "msps"
ADD COLUMN "enrollmentDate" TIMESTAMP(3);

UPDATE "msps"
SET "enrollmentDate" = "createdAt"
WHERE "enrollmentDate" IS NULL;

ALTER TABLE "msps"
ALTER COLUMN "enrollmentDate" SET NOT NULL,
ALTER COLUMN "enrollmentDate" SET DEFAULT CURRENT_TIMESTAMP;
