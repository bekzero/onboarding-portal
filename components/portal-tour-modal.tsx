"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PortalTourStep = {
  body: string;
  id: string;
  target?: string;
  title: string;
};

type SpotlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type PopoverPosition = {
  left: number;
  top: number;
  width: number;
};

type PortalTourModalProps = {
  currentStep: number;
  onBack: () => void;
  onClose: () => void;
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  onTargetMissing: () => void;
  open: boolean;
  steps: PortalTourStep[];
};

const VIEWPORT_MARGIN = 12;
const SPOTLIGHT_PADDING = 6;
const POPOVER_GAP = 14;

function getPopoverPosition(rect: SpotlightRect | null, width: number, height: number): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safeWidth = Math.min(width, viewportWidth - VIEWPORT_MARGIN * 2);
  const maxLeft = viewportWidth - safeWidth - VIEWPORT_MARGIN;

  if (!rect) {
    return {
      left: Math.max(VIEWPORT_MARGIN, (viewportWidth - safeWidth) / 2),
      top: Math.max(VIEWPORT_MARGIN, (viewportHeight - height) / 2),
      width: safeWidth
    };
  }

  const space = {
    above: rect.top - POPOVER_GAP - VIEWPORT_MARGIN,
    below: viewportHeight - (rect.top + rect.height) - POPOVER_GAP - VIEWPORT_MARGIN,
    left: rect.left - POPOVER_GAP - VIEWPORT_MARGIN,
    right: viewportWidth - (rect.left + rect.width) - POPOVER_GAP - VIEWPORT_MARGIN
  };
  const centeredLeft = Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - safeWidth / 2));
  const centeredTop = Math.min(
    viewportHeight - height - VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, rect.top + rect.height / 2 - height / 2)
  );

  if (viewportWidth >= 768 && space.right >= safeWidth) {
    return { left: rect.left + rect.width + POPOVER_GAP, top: centeredTop, width: safeWidth };
  }

  if (viewportWidth >= 768 && space.left >= safeWidth) {
    return { left: rect.left - safeWidth - POPOVER_GAP, top: centeredTop, width: safeWidth };
  }

  if (space.below >= height || space.below >= space.above) {
    return {
      left: centeredLeft,
      top: Math.min(viewportHeight - height - VIEWPORT_MARGIN, rect.top + rect.height + POPOVER_GAP),
      width: safeWidth
    };
  }

  return {
    left: centeredLeft,
    top: Math.max(VIEWPORT_MARGIN, rect.top - height - POPOVER_GAP),
    width: safeWidth
  };
}

function getSpotlightRect(target: Element): SpotlightRect | null {
  const bounds = target.getBoundingClientRect();
  const styles = window.getComputedStyle(target);

  if (bounds.width === 0 || bounds.height === 0 || styles.display === "none" || styles.visibility === "hidden") {
    return null;
  }

  if (
    bounds.bottom <= VIEWPORT_MARGIN ||
    bounds.top >= window.innerHeight - VIEWPORT_MARGIN ||
    bounds.right <= VIEWPORT_MARGIN ||
    bounds.left >= window.innerWidth - VIEWPORT_MARGIN
  ) {
    return null;
  }

  const left = Math.max(VIEWPORT_MARGIN, bounds.left - SPOTLIGHT_PADDING);
  const top = Math.max(VIEWPORT_MARGIN, bounds.top - SPOTLIGHT_PADDING);
  const right = Math.min(window.innerWidth - VIEWPORT_MARGIN, bounds.right + SPOTLIGHT_PADDING);
  const bottom = Math.min(window.innerHeight - VIEWPORT_MARGIN, bounds.bottom + SPOTLIGHT_PADDING);

  return {
    height: Math.max(0, bottom - top),
    left,
    top,
    width: Math.max(0, right - left)
  };
}

export function PortalTourModal({
  currentStep,
  onBack,
  onClose,
  onFinish,
  onNext,
  onSkip,
  onTargetMissing,
  open,
  steps
}: PortalTourModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<Element | null>(null);
  const missingTargetCallbackRef = useRef(onTargetMissing);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [popoverSize, setPopoverSize] = useState({ height: 280, width: 360 });
  const step = steps[currentStep];
  const hasTarget = Boolean(step?.target);
  const isStepReady = !hasTarget || Boolean(spotlightRect);

  useEffect(() => {
    missingTargetCallbackRef.current = onTargetMissing;
  }, [onTargetMissing]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!previouslyFocusedRef.current) {
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    return () => {
      if (previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus({ preventScroll: true });
        previouslyFocusedRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !step || !isStepReady) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentStep, isStepReady, open, step]);

  useEffect(() => {
    if (!open || !step?.target) {
      targetRef.current = null;
      setSpotlightRect(null);
      return;
    }

    let animationFrame = 0;
    let attempts = 0;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    function updatePosition() {
      if (!targetRef.current) {
        return;
      }

      setSpotlightRect(getSpotlightRect(targetRef.current));
    }

    function findTarget() {
      if (cancelled || !step.target) {
        return;
      }

      const target = document.querySelector(step.target);
      const nextRect = target ? getSpotlightRect(target) : null;

      if (!target || !nextRect) {
        if (target && attempts === 0) {
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
        }
        attempts += 1;
        if (attempts < 180) {
          animationFrame = window.requestAnimationFrame(findTarget);
        } else {
          missingTargetCallbackRef.current();
        }
        return;
      }

      targetRef.current = target;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest"
      });
      setSpotlightRect(nextRect);

      resizeObserver = new ResizeObserver(updatePosition);
      resizeObserver.observe(target);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
    }

    setSpotlightRect(null);
    animationFrame = window.requestAnimationFrame(findTarget);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      targetRef.current = null;
    };
  }, [currentStep, open, step]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) {
      return;
    }

    const updateSize = () => {
      const bounds = panel.getBoundingClientRect();
      setPopoverSize({ height: bounds.height, width: bounds.width });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(panel);
    updateSize();

    return () => observer.disconnect();
  }, [currentStep, open, spotlightRect]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || !step) {
    return null;
  }

  if (hasTarget && !spotlightRect) {
    return (
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[70] bg-overlay/70"
        data-portal-tour-overlay
        onClick={(event) => event.preventDefault()}
        onPointerDown={(event) => event.preventDefault()}
      />
    );
  }

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const position = getPopoverPosition(spotlightRect, popoverSize.width, popoverSize.height);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" data-portal-tour-overlay>
      <div
        aria-hidden="true"
        className="pointer-events-auto fixed inset-0"
        onClick={(event) => event.preventDefault()}
        onPointerDown={(event) => event.preventDefault()}
      />

      {spotlightRect ? (
        <div
          aria-hidden="true"
          className="pointer-events-auto fixed rounded-2xl border-2 border-primary transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
          onClick={(event) => event.preventDefault()}
          onPointerDown={(event) => event.preventDefault()}
          style={{
            boxShadow: "0 0 0 9999px rgb(var(--color-overlay) / 0.78)",
            height: spotlightRect.height,
            left: spotlightRect.left,
            top: spotlightRect.top,
            width: spotlightRect.width
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-overlay/80" />
      )}

      <div
        aria-describedby="portal-tour-description"
        aria-labelledby="portal-tour-title"
        aria-modal="true"
        className="pointer-events-auto fixed max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-2xl border border-border bg-surface shadow-panel transition-[top,left] duration-200 motion-reduce:transition-none"
        ref={panelRef}
        role="dialog"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <div className="border-b border-border bg-accent px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-info">
                Portal Tour · Step {currentStep + 1} of {steps.length}
              </p>
              <h2 className="mt-1.5 text-lg font-semibold leading-6 text-foreground" id="portal-tour-title">
                {step.title}
              </h2>
            </div>
            <Button aria-label="Close Portal Tour" className="h-8 w-8 shrink-0 px-0" onClick={onClose} variant="outline">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div aria-hidden="true" className="mt-3 flex gap-1.5">
            {steps.map((tourStep, index) => (
              <span
                className={`h-1 flex-1 rounded-full ${index <= currentStep ? "bg-primary" : "bg-subtle"}`}
                key={tourStep.id}
              />
            ))}
          </div>
        </div>

        <div className="px-4 py-4">
          <p className="text-sm leading-6 text-secondary" id="portal-tour-description">
            {step.body}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button className="h-9 px-3" onClick={onSkip} variant="outline">
            Skip Tour
          </Button>
          <div className="flex items-center gap-2">
            <Button className="h-9 px-3" disabled={isFirstStep} onClick={onBack} variant="outline">
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            {isLastStep ? (
              <Button className="h-9 px-3" data-tour-primary onClick={onFinish}>
                Go to My Next Task
              </Button>
            ) : (
              <Button className="h-9 px-3" data-tour-primary onClick={onNext}>
                Next
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
