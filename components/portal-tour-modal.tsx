"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type PortalTourStep = {
  body: string;
  title: string;
};

type PortalTourModalProps = {
  currentStep: number;
  onBack: () => void;
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  open: boolean;
  steps: PortalTourStep[];
};

export function PortalTourModal({
  currentStep,
  onBack,
  onFinish,
  onNext,
  onSkip,
  open,
  steps
}: PortalTourModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nextFrame = window.requestAnimationFrame(() => {
      const focusTarget =
        panelRef.current?.querySelector<HTMLElement>("[data-tour-primary]") ??
        panelRef.current?.querySelector<HTMLElement>("button");
      focusTarget?.focus();
    });

    return () => {
      window.cancelAnimationFrame(nextFrame);
      previouslyFocused?.focus();
    };
  }, [currentStep, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!panelRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSkip, open]);

  if (!open) {
    return null;
  }

  const step = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 md:p-6">
      <Card
        aria-labelledby="portal-tour-title"
        aria-modal="true"
        className="w-full max-w-2xl border-white/10 bg-[#101c31] shadow-panel"
        role="dialog"
      >
        <div ref={panelRef}>
          <div className="border-b border-white/10 bg-[linear-gradient(135deg,#223c78_0%,#101c31_58%,#09111d_100%)] px-5 py-5 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-blue-100/80">Portal Tour</p>
              <h2 className="mt-2 text-2xl font-semibold text-white md:text-[2rem]" id="portal-tour-title">
                {step.title}
              </h2>
            </div>
            <Button aria-label="Skip Tour" className="h-9 px-2.5" onClick={onSkip} variant="outline">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-sm text-blue-100/80">
              Step {currentStep + 1} of {steps.length}
            </p>
            <div className="flex flex-1 items-center gap-2 pl-4">
              {steps.map((tourStep, index) => (
                <span
                  aria-hidden="true"
                  className={`h-1.5 flex-1 rounded-full ${
                    index <= currentStep ? "bg-gradient-to-r from-blue-400 to-cyan-300" : "bg-white/10"
                  }`}
                  key={tourStep.title}
                />
              ))}
            </div>
          </div>
          </div>

          <div className="px-5 py-6 md:px-6">
            <div className="rounded-[1.35rem] border border-white/10 bg-[#0a1424] p-5">
              <p className="text-base leading-7 text-slate-200">{step.body}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 bg-[#101c31] px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
            <Button onClick={onSkip} variant="outline">
              Skip Tour
            </Button>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button disabled={isFirstStep} onClick={onBack} variant="outline">
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              {isLastStep ? (
                <Button data-tour-primary onClick={onFinish}>
                  Finish Tour
                </Button>
              ) : (
                <Button data-tour-primary onClick={onNext}>
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
