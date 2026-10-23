import { cn } from "@/lib/utils";

const statusClasses: Record<string, string> = {
  not_started: "bg-subtle text-secondary",
  in_progress: "bg-info-surface text-info",
  waiting_on_msp: "bg-warning-surface text-warning",
  waiting_on_kzero: "bg-info-surface text-info",
  complete: "bg-success-surface text-success"
};

export function Badge({
  className,
  status,
  children
}: React.HTMLAttributes<HTMLSpanElement> & { status?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        status ? statusClasses[status] : "bg-subtle text-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
