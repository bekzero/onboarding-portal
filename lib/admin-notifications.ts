import "server-only";
import { prisma } from "@/lib/prisma";

export type AdminNotificationRecord = {
  createdAt: string;
  id: string;
  isRead: boolean;
  mspId: string;
  mspName: string;
  planId: string;
  readAt: string | null;
  stage: string;
  taskId: string;
  taskTitle: string;
  type: "task_completed";
};

function toNotificationRecord(notification: {
  createdAt: Date;
  id: string;
  isRead: boolean;
  mspId: string;
  mspName: string;
  planId: string;
  readAt: Date | null;
  stage: string;
  taskId: string;
  taskTitle: string;
  type: "task_completed";
}) {
  return {
    createdAt: notification.createdAt.toISOString(),
    id: notification.id,
    isRead: notification.isRead,
    mspId: notification.mspId,
    mspName: notification.mspName,
    planId: notification.planId,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    stage: notification.stage,
    taskId: notification.taskId,
    taskTitle: notification.taskTitle,
    type: notification.type
  } satisfies AdminNotificationRecord;
}

export async function createTaskCompletedAdminNotification(input: {
  mspId: string;
  mspName: string;
  planId: string;
  stage: string;
  taskId: string;
  taskTitle: string;
}) {
  const notification = await prisma.adminNotification.upsert({
    where: {
      mspId_planId_taskId_type: {
        mspId: input.mspId,
        planId: input.planId,
        taskId: input.taskId,
        type: "task_completed"
      }
    },
    update: {},
    create: {
      mspId: input.mspId,
      mspName: input.mspName,
      planId: input.planId,
      stage: input.stage,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      type: "task_completed"
    }
  });

  return toNotificationRecord({
    ...notification,
    type: notification.type as "task_completed"
  });
}

export async function getAdminNotifications() {
  const notifications = await prisma.adminNotification.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });

  return notifications.map((notification) =>
    toNotificationRecord({
      ...notification,
      type: notification.type as "task_completed"
    })
  );
}

export async function markAdminNotificationRead(notificationId: string) {
  const notification = await prisma.adminNotification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return toNotificationRecord({
    ...notification,
    type: notification.type as "task_completed"
  });
}

export async function markAllAdminNotificationsRead() {
  const result = await prisma.adminNotification.updateMany({
    where: {
      isRead: false
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return result.count;
}
