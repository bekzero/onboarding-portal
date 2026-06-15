import { cn } from "@/lib/utils";

const statusClasses: Record<string, string> = {
  not_started: "bg-slate-800 text-slate-200",
  in_progress: "bg-blue-500/20 text-blue-200",
  waiting_on_msp: "bg-amber-500/20 text-amber-100",
  waiting_on_kzero: "bg-fuchsia-500/20 text-fuchsia-100",
  complete: "bg-emerald-500/20 text-emerald-100"
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
        status ? statusClasses[status] : "bg-white/10 text-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
