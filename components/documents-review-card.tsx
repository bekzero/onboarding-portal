"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImageIcon, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Attachment } from "@/lib/mock-data";

type ReviewStatus = "Submitted" | "In review" | "Approved";

type StoredDocument = {
  id: string;
  name: string;
  size: number;
  status: ReviewStatus;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
};

type DocumentItem = {
  id: string;
  isStored: boolean;
  name: string;
  sizeLabel: string;
  status: ReviewStatus;
  typeLabel: string;
  uploadedBy: string;
};

function getStorageKey(planId: string) {
  return `kzero-review-documents:${planId}`;
}

function formatSize(bytes: number) {
  if (bytes <= 0) {
    return "Pending";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTypeLabel(type: string, attachmentName?: string) {
  if (type.startsWith("image/")) {
    return "Image";
  }

  if (type === "application/pdf") {
    return "PDF";
  }

  if (type.includes("word")) {
    return "Word document";
  }

  if (type.includes("text")) {
    return "Text document";
  }

  if (attachmentName?.toLowerCase().includes("guide")) {
    return "Guide";
  }

  if (attachmentName?.toLowerCase().includes("plan")) {
    return "Plan";
  }

  return "Document";
}

function getStatusTone(status: ReviewStatus) {
  if (status === "Approved") {
    return "complete" as const;
  }

  if (status === "In review") {
    return "waiting_on_kzero" as const;
  }

  return "waiting_on_msp" as const;
}

export function DocumentsReviewCard({
  attachments,
  planId
}: {
  attachments: Attachment[];
  planId: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([]);

  useEffect(() => {
    const rawValue = window.localStorage.getItem(getStorageKey(planId));

    if (!rawValue) {
      setStoredDocuments([]);
      return;
    }

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      setStoredDocuments(Array.isArray(parsed) ? (parsed as StoredDocument[]) : []);
    } catch {
      setStoredDocuments([]);
    }
  }, [planId]);

  useEffect(() => {
    // TODO: production needs secure server-side document storage and malware scanning.
    // This demo intentionally stores only file metadata in localStorage, never file contents.
    window.localStorage.setItem(getStorageKey(planId), JSON.stringify(storedDocuments));
  }, [planId, storedDocuments]);

  const documents = useMemo(() => {
    const planned = attachments.map((attachment) => ({
      id: attachment.id,
      isStored: false,
      name: attachment.name,
      sizeLabel: "Planned",
      status: "Approved" as ReviewStatus,
      typeLabel: formatTypeLabel("", attachment.name),
      uploadedBy: "KZero"
    }));

    const uploaded = storedDocuments.map((item) => ({
      id: item.id,
      isStored: true,
      name: item.name,
      sizeLabel: formatSize(item.size),
      status: item.status,
      typeLabel: formatTypeLabel(item.type, item.name),
      uploadedBy: item.uploadedBy
    }));

    return [...uploaded, ...planned] satisfies DocumentItem[];
  }, [attachments, storedDocuments]);

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    const uploadedAt = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short"
    }).format(new Date());

    setStoredDocuments((current) => [
      ...selectedFiles.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}`,
        name: file.name,
        size: file.size,
        status: "Submitted" as ReviewStatus,
        type: file.type || "application/octet-stream",
        uploadedAt,
        uploadedBy: "MSP Admin"
      })),
      ...current
    ]);

    event.target.value = "";
  }

  function updateDocumentStatus(id: string, status: ReviewStatus) {
    setStoredDocuments((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item))
    );
  }

  return (
    <Card className="border-white/10 bg-[#101a2d] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <FileText className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Documents for Review</h3>
          <p className="text-sm text-slate-300">
            Share supporting files for rollout review. File metadata stays in this browser for now.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          accept=".pdf,.doc,.docx,.txt,image/*"
          className="hidden"
          multiple
          onChange={handleFileSelection}
          ref={inputRef}
          type="file"
        />
        <Button className="h-10 px-4" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Select documents
        </Button>
        <p className="text-xs text-slate-400">
          Accepted: PDF, Word, text, and image files.
        </p>
      </div>

      <div className="mt-4 grid gap-3">
        {documents.length === 0 ? (
          <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-[#0a1424] px-3.5 py-4 text-sm text-slate-400">
            No review documents added yet.
          </div>
        ) : null}

        {documents.map((document) => (
          <div key={document.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {document.typeLabel === "Image" ? (
                    <ImageIcon className="h-4 w-4 text-slate-400" />
                  ) : (
                    <FileText className="h-4 w-4 text-slate-400" />
                  )}
                  <p className="truncate font-medium text-white">{document.name}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                  <span>Type: {document.typeLabel}</span>
                  <span>Size: {document.sizeLabel}</span>
                  <span>Uploaded by: {document.uploadedBy}</span>
                </div>
              </div>
              <Badge status={getStatusTone(document.status)}>{document.status}</Badge>
            </div>

            {document.isStored ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button className="h-8 px-3" onClick={() => updateDocumentStatus(document.id, "Submitted")} variant="outline">
                  Mark submitted
                </Button>
                <Button className="h-8 px-3" onClick={() => updateDocumentStatus(document.id, "In review")} variant="outline">
                  Mark in review
                </Button>
                <Button className="h-8 px-3" onClick={() => updateDocumentStatus(document.id, "Approved")} variant="outline">
                  Approve
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
