"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, ImageIcon, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  formatDocumentSize,
  MAX_DOCUMENT_SIZE_BYTES,
  type PortalDocumentRecord
} from "@/lib/onboarding-document-config";

const EMPTY_DOCUMENTS: PortalDocumentRecord[] = [];

type DocumentsReviewCardProps = {
  canUpload?: boolean;
  emptyStateTitle?: string;
  initialDocuments?: PortalDocumentRecord[];
  listUrl?: string;
  planType: "nfr" | "customer";
  subtitle?: string;
  title?: string;
  uploadUrl?: string;
};

function formatUploadedDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

function getStatusTone(status: string) {
  const normalizedStatus = status.trim().toLowerCase();

  if (normalizedStatus === "approved" || normalizedStatus === "complete") {
    return "complete" as const;
  }

  if (normalizedStatus === "in_review" || normalizedStatus === "in review" || normalizedStatus === "waiting_on_kzero") {
    return "waiting_on_kzero" as const;
  }

  return "waiting_on_msp" as const;
}

function formatStatusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getSubtitle(planType: "nfr" | "customer") {
  return planType === "customer"
    ? "Upload and review supporting files for the customer onboarding plan."
    : "Upload and review supporting files for your onboarding plan.";
}

function getEmptyStateBody(planType: "nfr" | "customer") {
  return planType === "customer"
    ? "Documents shared by the MSP, customer, or KZero Passwordless will appear here."
    : "Documents shared by your team or KZero Passwordless will appear here.";
}

export function DocumentsReviewCard({
  canUpload = false,
  emptyStateTitle = "No Documents Added",
  initialDocuments = EMPTY_DOCUMENTS,
  listUrl,
  planType,
  subtitle,
  title = "Documents for Review",
  uploadUrl
}: DocumentsReviewCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<PortalDocumentRecord[]>(initialDocuments);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(listUrl));
  const [isUploading, setIsUploading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!listUrl) {
      setDocuments(initialDocuments);
    }
  }, [initialDocuments, listUrl]);

  useEffect(() => {
    if (!listUrl) {
      setIsLoading(false);
      return;
    }

    const nextListUrl = listUrl;
    let isCancelled = false;

    async function loadDocuments() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(nextListUrl, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              documents?: PortalDocumentRecord[];
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.documents) {
          throw new Error(payload?.error ?? "Could not load documents.");
        }

        if (!isCancelled) {
          setDocuments(payload.documents);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage("Documents could not be loaded right now.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDocuments();

    return () => {
      isCancelled = true;
    };
  }, [listUrl, refreshToken]);

  const acceptedTypesLabel = useMemo(
    () => `Accepted: PDF, Word, spreadsheet, TXT, PNG, JPG, JPEG, and WEBP files up to ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB each.`,
    []
  );

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);

    if (!uploadUrl || selectedFiles.length === 0) {
      event.target.value = "";
      return;
    }

    const nextUploadUrl = uploadUrl;
    setIsUploading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(nextUploadUrl, {
        body: formData,
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            documents?: PortalDocumentRecord[];
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.documents) {
        throw new Error(payload?.error ?? "Could not upload the selected documents.");
      }

      setRefreshToken((current) => current + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not upload the selected documents.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  return (
    <Card className="border-white/10 bg-[#101a2d] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-slate-300">{subtitle ?? getSubtitle(planType)}</p>
          </div>
        </div>

        {canUpload && uploadUrl ? (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <input
              accept={DOCUMENT_UPLOAD_ACCEPT}
              className="hidden"
              multiple
              onChange={handleFileSelection}
              ref={inputRef}
              type="file"
            />
            <Button className="h-10 px-4" disabled={isUploading} onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              {isUploading ? "Uploading..." : "Upload Documents"}
            </Button>
            <p className="max-w-md text-xs text-slate-400">{acceptedTypesLabel}</p>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-[1.1rem] border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {isLoading ? (
          <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] px-4 py-4 text-sm text-slate-300">
            Loading documents...
          </div>
        ) : null}

        {!isLoading && documents.length === 0 ? (
          <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-[#0a1424] px-4 py-4">
            <p className="text-base font-semibold text-white">{emptyStateTitle}</p>
            <p className="mt-2 text-sm text-slate-400">{getEmptyStateBody(planType)}</p>
          </div>
        ) : null}

        {!isLoading
          ? documents.map((document) => (
              <div key={document.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {document.fileType.toLowerCase().includes("image") ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      )}
                      <p className="truncate font-medium text-white">{document.fileName}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                      <span>Type: {document.fileType}</span>
                      <span>Size: {formatDocumentSize(document.fileSize)}</span>
                      <span>Uploaded: {formatUploadedDate(document.createdAt)}</span>
                      {document.uploadedByName ? <span>Uploaded by: {document.uploadedByName}</span> : null}
                      {document.uploadedByRole ? <span>Role: {document.uploadedByRole}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-start">
                    <Badge status={getStatusTone(document.status)}>{formatStatusLabel(document.status)}</Badge>
                    {document.storageUrl ? (
                      <a href={document.storageUrl} rel="noreferrer" target="_blank">
                        <Button className="h-8 px-3" variant="outline">
                          <Download className="mr-2 h-3.5 w-3.5" />
                          Open / Download
                        </Button>
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          : null}
      </div>
    </Card>
  );
}
