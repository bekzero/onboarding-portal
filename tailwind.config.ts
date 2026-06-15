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
        background: "#08111f",
        foreground: "#e8f0ff",
        card: "#0e1a2d",
        border: "#1f3554",
        primary: "#3b82f6",
        muted: "#8aa0c2",
        accent: "#163a70"
      },
      boxShadow: {
        panel: "0 18px 60px rgba(2, 8, 23, 0.32)"
      }
    }
  },
  plugins: []
};

export default config;
