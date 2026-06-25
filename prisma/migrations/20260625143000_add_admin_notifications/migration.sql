CREATE TYPE "AdminNotificationType" AS ENUM ('task_completed');

CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "mspId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "mspName" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_notifications_mspId_planId_taskId_type_key"
ON "admin_notifications"("mspId", "planId", "taskId", "type");

CREATE INDEX "admin_notifications_createdAt_idx"
ON "admin_notifications"("createdAt");

CREATE INDEX "admin_notifications_isRead_createdAt_idx"
ON "admin_notifications"("isRead", "createdAt");

ALTER TABLE "admin_notifications"
ADD CONSTRAINT "admin_notifications_mspId_fkey"
FOREIGN KEY ("mspId") REFERENCES "msps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
