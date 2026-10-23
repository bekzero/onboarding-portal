"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";
const THEME_STORAGE_KEY = "kzero-color-theme";

function getDocumentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getDocumentTheme());

    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = event.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = getDocumentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Storage may be restricted in embedded browsers; the active page still changes theme.
    }
  }

  const nextThemeLabel = theme === "dark" ? "Light" : "Dark";

  return (
    <button
      aria-label={`Switch to ${nextThemeLabel} Mode`}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground transition hover:border-border-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      onClick={toggleTheme}
      title={`Switch to ${nextThemeLabel} Mode`}
      type="button"
    >
      <span className="theme-dark-only inline-flex items-center">
        <Moon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dark mode selected</span>
      </span>
      <span className="theme-light-only inline-flex items-center">
        <Sun className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Light mode selected</span>
      </span>
    </button>
  );
}
