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

export function GuidePreviewModal({
  guidePreview,
  onClose
}: {
  guidePreview: GuidePreviewState;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<GuidePreviewMap>({});
  const [loadingUrls, setLoadingUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!guidePreview) {
      setPreviews({});
      setLoadingUrls([]);
      return;
    }

    const urls = guidePreview.guides.map((guide) => guide.href);
    setLoadingUrls(urls);
    setPreviews({});

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

  if (!guidePreview) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#020611]/75 p-4 md:items-center">
      <div className="w-full max-w-3xl rounded-[1.6rem] border border-white/10 bg-[#0d1627] p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Guide Preview</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{guidePreview.stepName}</h3>
            <p className="mt-1 text-sm text-slate-300">Review the Partner Portal article preview here, then open the full guide in a new tab when you are ready.</p>
          </div>
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-3">
          {guidePreview.guides.map((guide) => {
            const preview = previews[guide.href];
            const isLoading = loadingUrls.includes(guide.href);

            return (
              <div key={guide.href} className="rounded-[1.2rem] border border-white/10 bg-[#0a1424] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Related Step</p>
                <p className="mt-1 font-medium text-white">{guidePreview.stepName}</p>

                {isLoading ? (
                  <div className="mt-4 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                    <p className="text-sm font-medium text-white">{guide.title}</p>
                    <p className="mt-2 text-sm text-slate-300">Loading preview...</p>
                  </div>
                ) : null}

                {!isLoading && preview ? (
                  <>
                    <h4 className="mt-4 text-lg font-semibold text-white">{preview.title}</h4>
                    {preview.intro ? <p className="mt-2 text-sm leading-6 text-slate-300">{preview.intro}</p> : null}

                    {preview.kind === "collection" ? (
                      <div className="mt-4 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                        <p className="text-sm text-slate-300">{preview.message}</p>
                      </div>
                    ) : null}

                    {preview.kind === "unavailable" ? (
                      <div className="mt-4 rounded-[1rem] border border-white/10 bg-[#08111f] p-4">
                        <p className="text-sm font-medium text-white">Preview unavailable</p>
                        <p className="mt-2 text-sm text-slate-300">{preview.message ?? "Open the full guide to view the article."}</p>
                      </div>
                    ) : null}

                    {preview.headings.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Headings</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {preview.headings.map((heading) => (
                            <span key={heading} className="rounded-full border border-white/10 bg-[#08111f] px-3 py-1 text-sm text-slate-200">
                              {heading}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {preview.steps.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Article Steps</p>
                        <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-300">
                          {preview.steps.map((step) => (
                            <li key={step} className="rounded-[0.95rem] border border-white/10 bg-[#08111f] px-3 py-2">
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {preview.images.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Images</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {preview.images.map((imageUrl) => (
                            <a
                              key={imageUrl}
                              className="rounded-[0.95rem] border border-white/10 bg-[#08111f] px-3 py-2 text-sm text-blue-200 hover:text-blue-100"
                              href={imageUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open image
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}

                <a
                  className={`${buttonVariants({ variant: "secondary" })} mt-4 inline-flex`}
                  href={guide.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Full Guide
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
