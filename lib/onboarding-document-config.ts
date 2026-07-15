export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_UPLOAD_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp";

const DOCUMENT_TYPE_RULES: Array<{
  extensions: string[];
  label: string;
  mimeTypes: string[];
}> = [
  {
    extensions: ["pdf"],
    label: "PDF",
    mimeTypes: ["application/pdf"]
  },
  {
    extensions: ["doc", "docx"],
    label: "Word Document",
    mimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]
  },
  {
    extensions: ["xls", "xlsx", "csv"],
    label: "Spreadsheet",
    mimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv"
    ]
  },
  {
    extensions: ["txt"],
    label: "Text File",
    mimeTypes: ["text/plain"]
  },
  {
    extensions: ["png"],
    label: "PNG Image",
    mimeTypes: ["image/png"]
  },
  {
    extensions: ["jpg", "jpeg"],
    label: "JPEG Image",
    mimeTypes: ["image/jpeg"]
  },
  {
    extensions: ["webp"],
    label: "WEBP Image",
    mimeTypes: ["image/webp"]
  }
];

function getFileExtension(fileName: string) {
  const parts = fileName.trim().toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function sanitizeDocumentFileName(fileName: string) {
  const trimmedFileName = fileName.trim();

  if (!trimmedFileName) {
    return "document";
  }

  return trimmedFileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "document";
}

export function getDocumentTypeLabel(fileName: string, mimeType?: string | null) {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  const extension = getFileExtension(fileName);
  const matchedRule = DOCUMENT_TYPE_RULES.find(
    (rule) => rule.extensions.includes(extension) || rule.mimeTypes.includes(normalizedMimeType)
  );

  return matchedRule?.label ?? "Document";
}

export function isAllowedDocumentType(fileName: string, mimeType?: string | null) {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  const extension = getFileExtension(fileName);

  return DOCUMENT_TYPE_RULES.some(
    (rule) => rule.extensions.includes(extension) || rule.mimeTypes.includes(normalizedMimeType)
  );
}

export function formatDocumentSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) {
    return "Unknown Size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type PortalDocumentRecord = {
  createdAt: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
  id: string;
  status: string;
  storageUrl: string;
  uploadedByName?: string | null;
  uploadedByRole?: string | null;
};
