import "server-only";

import { del, get, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import {
  getDocumentTypeLabel,
  isAllowedDocumentType,
  MAX_DOCUMENT_SIZE_BYTES,
  sanitizeDocumentFileName,
  type PortalDocumentRecord
} from "@/lib/onboarding-document-config";

function isBlobStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function buildDocumentPath(planId: string, fileName: string) {
  return `onboarding-documents/${planId}/${sanitizeDocumentFileName(fileName)}`;
}

function toPortalDocumentRecord(document: {
  createdAt: Date;
  fileName: string;
  fileSize: number | null;
  id: string;
  mimeType: string | null;
  status: string;
  storageKey: string | null;
  storageUrl: string | null;
  uploadedBy: string | null;
  uploadedByRole: string | null;
}) {
  return {
    createdAt: document.createdAt.toISOString(),
    fileName: document.fileName,
    fileSize: document.fileSize,
    fileType: getDocumentTypeLabel(document.fileName, document.mimeType),
    hasDownload: Boolean(document.storageKey || document.storageUrl),
    id: document.id,
    status: document.status,
    uploadedByName: document.uploadedBy,
    uploadedByRole: document.uploadedByRole
  } satisfies PortalDocumentRecord;
}

function validateDocumentFile(file: File) {
  const trimmedName = file.name.trim();

  if (!trimmedName) {
    throw new Error("Each uploaded file must have a file name.");
  }

  if (!isAllowedDocumentType(trimmedName, file.type)) {
    throw new Error("Unsupported file type. Upload PDF, Word, spreadsheet, TXT, PNG, JPG, JPEG, or WEBP files.");
  }

  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("Each file must be 10 MB or smaller.");
  }
}

async function getPersistedPlan(planId: string) {
  return prisma.onboardingPlan.findUnique({
    where: { planId },
    select: {
      id: true,
      tenantType: true
    }
  });
}

export async function listOnboardingDocuments(planId: string) {
  const onboardingPlan = await getPersistedPlan(planId);

  if (!onboardingPlan) {
    return null;
  }

  const documents = await prisma.document.findMany({
    where: {
      onboardingPlanId: onboardingPlan.id
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      createdAt: true,
      fileName: true,
      fileSize: true,
      id: true,
      mimeType: true,
      status: true,
      storageKey: true,
      storageUrl: true,
      uploadedBy: true,
      uploadedByRole: true
    }
  });

  return documents.map(toPortalDocumentRecord);
}

export async function uploadOnboardingDocuments({
  files,
  planId,
  uploadedByName
}: {
  files: File[];
  planId: string;
  uploadedByName?: string | null;
}) {
  const onboardingPlan = await getPersistedPlan(planId);

  if (!onboardingPlan) {
    return null;
  }

  if (!isBlobStorageConfigured()) {
    throw new Error("Document storage is not configured. Add BLOB_READ_WRITE_TOKEN on the server.");
  }

  if (files.length === 0) {
    throw new Error("Select at least one document to upload.");
  }

  files.forEach(validateDocumentFile);

  const createdDocuments = await Promise.all(
    files.map(async (file) => {
      const blobPath = buildDocumentPath(planId, file.name);
      const uploadedByRole = onboardingPlan.tenantType === "customer" ? "Customer" : "MSP";
      const uploadedBlob = await put(blobPath, file, {
        access: "private",
        addRandomSuffix: true,
        contentType: file.type || undefined
      });

      try {
        const document = await prisma.document.create({
          data: {
            fileName: file.name.trim(),
            fileSize: file.size,
            mimeType: file.type || null,
            onboardingPlanId: onboardingPlan.id,
            storageKey: uploadedBlob.pathname,
            storageUrl: uploadedBlob.url,
            uploadedBy: uploadedByName?.trim() || null,
            uploadedByRole
          }
        });

        return toPortalDocumentRecord(document);
      } catch (error) {
        await del(uploadedBlob.pathname).catch(() => null);
        throw error;
      }
    })
  );

  return createdDocuments;
}

export async function getOnboardingDocumentForDownload(planId: string, documentId: string) {
  const onboardingPlan = await getPersistedPlan(planId);

  if (!onboardingPlan) {
    return { status: "plan_not_found" as const };
  }

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      onboardingPlanId: onboardingPlan.id
    },
    select: {
      fileName: true,
      id: true,
      mimeType: true,
      storageKey: true,
      storageUrl: true
    }
  });

  if (!document) {
    return { status: "document_not_found" as const };
  }

  const blobReference = document.storageKey?.trim() || document.storageUrl?.trim();

  if (!blobReference) {
    return { status: "document_not_found" as const };
  }

  const blobResult = await get(blobReference, {
    access: "private"
  });

  if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
    return { status: "document_not_found" as const };
  }

  return {
    blob: blobResult.blob,
    document,
    status: "found" as const,
    stream: blobResult.stream
  };
}
