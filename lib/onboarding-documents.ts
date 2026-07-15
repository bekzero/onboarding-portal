import "server-only";

import { del, put } from "@vercel/blob";
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
  storageUrl: string | null;
  uploadedBy: string | null;
  uploadedByRole: string | null;
}) {
  return {
    createdAt: document.createdAt.toISOString(),
    fileName: document.fileName,
    fileSize: document.fileSize,
    fileType: getDocumentTypeLabel(document.fileName, document.mimeType),
    id: document.id,
    status: document.status,
    storageUrl: document.storageUrl ?? "",
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
    }
  });

  return documents
    .filter((document) => Boolean(document.storageUrl))
    .map(toPortalDocumentRecord);
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
        access: "public",
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
        await del(uploadedBlob.url).catch(() => null);
        throw error;
      }
    })
  );

  return createdDocuments;
}
