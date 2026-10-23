"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGuideAccessLabel, type TaskGuide } from "@/lib/guide-previews";

export function TaskGuideAccess({
  guides,
  onOpenGuide
}: {
  guides: TaskGuide[];
  onOpenGuide: (guide: TaskGuide) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const guideButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const label = getGuideAccessLabel(guides.length);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    guideButtonRefs.current[0]?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!label) {
    return null;
  }

  if (guides.length === 1) {
    return (
      <Button className="h-9 rounded-xl px-3.5" onClick={() => onOpenGuide(guides[0])} variant="outline">
        {label}
      </Button>
    );
  }

  function focusGuideAt(index: number) {
    const nextIndex = (index + guides.length) % guides.length;
    guideButtonRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={isOpen ? "relative w-[min(22rem,calc(100vw-9rem))] md:w-80" : "relative w-auto"} ref={containerRef}>
      <Button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="h-9 rounded-xl px-3.5"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        ref={triggerRef}
        variant="outline"
      >
        {label}
        <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </Button>

      {isOpen ? (
        <div
          aria-label="Supporting guides"
          className="mt-2 w-full rounded-2xl border border-border bg-card p-2 shadow-panel"
          id={menuId}
          role="menu"
        >
          <div className="grid gap-1">
            {guides.map((guide, index) => (
              <button
                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-foreground transition hover:bg-hover focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                key={guide.href}
                onClick={() => {
                  triggerRef.current?.focus();
                  setIsOpen(false);
                  onOpenGuide(guide);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusGuideAt(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusGuideAt(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusGuideAt(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusGuideAt(guides.length - 1);
                  }
                }}
                ref={(element) => {
                  guideButtonRefs.current[index] = element;
                }}
                role="menuitem"
                type="button"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-5">{guide.title}</span>
                  {guide.description ? (
                    <span className="mt-1 block text-xs leading-5 text-muted">{guide.description}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
