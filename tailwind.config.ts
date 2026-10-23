import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-secondary": "rgb(var(--color-surface-secondary) / <alpha-value>)",
        input: "rgb(var(--color-input) / <alpha-value>)",
        card: "rgb(var(--color-surface) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-strong": "rgb(var(--color-border-strong) / <alpha-value>)",
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        "muted-subtle": "rgb(var(--color-muted-subtle) / <alpha-value>)",
        hover: "rgb(var(--color-hover) / <alpha-value>)",
        subtle: "rgb(var(--color-subtle) / <alpha-value>)",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        "primary-hover": "rgb(var(--color-primary-hover) / <alpha-value>)",
        "primary-foreground": "rgb(var(--color-primary-foreground) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--color-accent-hover) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        "info-surface": "rgb(var(--color-info-surface) / <alpha-value>)",
        "info-border": "rgb(var(--color-info-border) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        "success-surface": "rgb(var(--color-success-surface) / <alpha-value>)",
        "success-border": "rgb(var(--color-success-border) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        "warning-surface": "rgb(var(--color-warning-surface) / <alpha-value>)",
        "warning-border": "rgb(var(--color-warning-border) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        "danger-surface": "rgb(var(--color-danger-surface) / <alpha-value>)",
        "danger-border": "rgb(var(--color-danger-border) / <alpha-value>)",
        overlay: "rgb(var(--color-overlay) / <alpha-value>)"
      },
      boxShadow: {
        panel: "var(--panel-shadow)"
      }
    }
  },
  plugins: []
};

export default config;
