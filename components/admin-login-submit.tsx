"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function AdminLoginSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button className="h-12 w-full rounded-xl px-5" disabled={pending} type="submit">
      {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      <span aria-live="polite">{pending ? "Signing In..." : "Sign In"}</span>
    </Button>
  );
}
