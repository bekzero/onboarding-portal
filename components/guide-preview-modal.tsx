"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { GuidePreviewResult, TaskGuide } from "@/lib/guide-previews";

type GuidePreviewState = {
  guides: TaskGuide[];
  stepName: string;
} | null;

type GuidePreviewMap = Record<string, GuidePreviewResult | null>;

function hasLimitedPreviewContent(preview: GuidePreviewResult) {
  return preview.kind === "article" && preview.steps.length < 3 && preview.headings.length < 2;
}

export function GuidePreviewModal({
  guidePreview,
  onClose
}: {
  guidePreview: GuidePreviewState;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<GuidePreviewMap>({});
  const [loadingUrls, setLoadingUrls] = useState<string[]>([]);
  const [selectedGuideHref, setSelectedGuideHref] = useState<string | null>(null);
  const guides = guidePreview?.guides ?? [];
  const stepName = guidePreview?.stepName ?? "";

  useEffect(() => {
    if (!guidePreview) {
      setPreviews({});
      setLoadingUrls([]);
      setSelectedGuideHref(null);
      return;
    }

    const urls = guidePreview.guides.map((guide) => guide.href);
    setLoadingUrls(urls);
    setPreviews({});
    setSelectedGuideHref(urls[0] ?? null);

    let isCancelled = false;

    void Promise.all(
      guidePreview.guides.map(async (guide) => {
        try {
          const response = await fetch(`/api/guide-preview?url=${encodeURIComponent(guide.href)}`, {
            cache: "no-store"
          });

          if (!response.ok) {
            throw new Error("preview_failed");
          }

          const payload = (await response.json()) as { preview?: GuidePreviewResult };
          return [guide.href, payload.preview ?? null] as const;
        } catch {
          return [
            guide.href,
            {
              headings: [],
              images: [],
              intro: null,
              kind: "unavailable" as const,
              message: "Preview unavailable",
              steps: [],
              title: guide.title,
              url: guide.href
            }
          ] as const;
        }
      })
    ).then((results) => {
      if (isCancelled) {
        return;
      }

      setPreviews(Object.fromEntries(results));
      setLoadingUrls([]);
    });

    return () => {
      isCancelled = true;
    };
  }, [guidePreview]);

  const selectedGuide = guides.find((guide) => guide.href === selectedGuideHref) ?? guides[0] ?? null;
  const selectedPreview = selectedGuide ? previews[selectedGuide.href] : null;
  const modalTitle = selectedPreview?.title ?? selectedGuide?.title ?? "Guide Preview";
  const selectedGuideIsLoading = selectedGuide ? loadingUrls.includes(selectedGuide.href) : false;
  const hasMultipleGuides = guides.length > 1;
  const previewHeadings = selectedPreview?.headings ?? [];
  const previewSteps = selectedPreview?.steps ?? [];
  const previewImages = selectedPreview?.images ?? [];
  const previewIntro = selectedPreview?.intro ?? "";
  const previewMessage = selectedPreview?.message ?? "";
  const previewKind = selectedPreview?.kind ?? "unavailable";

  if (!guidePreview) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#020611]/75 p-4 md:items-center">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#0d1627] shadow-panel">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Guide Preview</p>
              <h3 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{modalTitle}</h3>
              <p className="mt-2 text-sm text-slate-300">Related Step: {stepName}</p>
            </div>
            <Button onClick={onClose} variant="outline">
              Close
            </Button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {hasMultipleGuides ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {guides.map((guide) => {
                const isSelected = guide.href === selectedGuide?.href;
                const previewTitle = previews[guide.href]?.title ?? guide.title;

                return (
                  <button
                    key={guide.href}
                    className={`rounded-full border px-3 py-2 text-sm transition ${
                      isSelected
                        ? "border-primary/40 bg-primary/15 text-white"
                        : "border-white/10 bg-[#0a1424] text-slate-300 hover:border-white/20 hover:text-white"
                    }`}
                    onClick={() => setSelectedGuideHref(guide.href)}
                    type="button"
                  >
                    {previewTitle}
                  </button>
                );
              })}
            </div>
          ) : null}

          {selectedGuide ? (
            <div key={selectedGuide.href} className="rounded-[1.2rem] border border-white/10 bg-[#0a1424] p-5">
              {selectedGuideIsLoading ? (
                <div className="rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                  <p className="text-lg font-semibold text-white">{selectedGuide.title}</p>
                  <p className="mt-2 text-sm text-slate-300">Loading preview...</p>
                </div>
              ) : null}

              {!selectedGuideIsLoading && selectedPreview ? (
                <>
                  <h4 className="text-2xl font-semibold text-white">{selectedPreview.title}</h4>

                  {previewIntro ? (
                    <section className="mt-5 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">What You'll Do</p>
                      <p className="mt-3 text-sm leading-7 text-slate-200">{previewIntro}</p>
                    </section>
                  ) : null}

                  {previewKind === "collection" ? (
                    <div className="mt-5 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                      <p className="text-sm text-slate-300">{previewMessage}</p>
                    </div>
                  ) : null}

                  {previewKind === "unavailable" ? (
                    <div className="mt-5 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                      <p className="text-sm font-medium text-white">Preview unavailable</p>
                      <p className="mt-2 text-sm text-slate-300">{previewMessage || "Open the full guide to view the article."}</p>
                    </div>
                  ) : null}

                  {previewKind === "article" && previewHeadings.length > 0 ? (
                    <section className="mt-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">In This Guide</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {previewHeadings.map((heading) => (
                          <div key={heading} className="rounded-[0.95rem] border border-white/10 bg-[#08111f] px-4 py-3">
                            <p className="font-medium text-white">{heading}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {previewKind === "article" && previewSteps.length > 0 ? (
                    <section className="mt-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Key Steps</p>
                      <ol className="mt-3 grid gap-3">
                        {previewSteps.map((step, index) => (
                          <li key={step} className="rounded-[1rem] border border-white/10 bg-[#08111f] px-4 py-4">
                            <div className="flex gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                                {index + 1}
                              </div>
                              <p className="pt-1 text-sm leading-7 text-slate-200">{step}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}

                  {previewImages.length > 0 ? (
                    <section className="mt-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Reference Images</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {previewImages.map((imageUrl, index) => (
                          <a
                            key={imageUrl}
                            className="group overflow-hidden rounded-[1rem] border border-white/10 bg-[#08111f] transition hover:border-white/20"
                            href={imageUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <img alt="" className="h-36 w-full object-cover" src={imageUrl} />
                            <div className="px-4 py-3 text-sm text-blue-200 group-hover:text-blue-100">
                              Open Image {index + 1}
                            </div>
                          </a>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {selectedPreview && hasLimitedPreviewContent(selectedPreview) ? (
                    <p className="mt-5 text-sm text-slate-400">
                      Preview may be abbreviated. Open the full guide for the complete article.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0b1424] px-5 py-4">
          <div>
            <p className="text-sm text-slate-300">Open the full article in a new tab when you need the complete guide.</p>
          </div>
          <div className="flex gap-3">
            {selectedGuide ? (
              <a
                className={buttonVariants({ variant: "secondary" })}
                href={selectedGuide.href}
                rel="noreferrer"
                target="_blank"
              >
                Open Full Guide
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            ) : null}
            <Button onClick={onClose} variant="outline">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
