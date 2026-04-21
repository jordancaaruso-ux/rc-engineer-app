import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Slightly lifted dark palette — each surface nudged ~4–10 points up
        // from the original so the UI reads as "broken up" rather than a flat
        // heavy dark. Keep identity: same green-tinted black, same primary red.
        background: "#0E1312",
        foreground: "#ECF2EF",
        card: {
          DEFAULT: "#19201D",
          foreground: "#ECF2EF"
        },
        primary: {
          DEFAULT: "#C92A2A",
          foreground: "#F8F9FA"
        },
        secondary: {
          DEFAULT: "#151C1A",
          foreground: "#ECF2EF"
        },
        muted: {
          DEFAULT: "#171F1C",
          foreground: "#B0BBB7"
        },
        accent: {
          DEFAULT: "#2563EB",
          foreground: "#F8F9FA"
        },
        destructive: "#7A1E1E",
        // Border tone bumped hardest — it's what makes cards feel like distinct
        // panels instead of a single dark wash.
        border: "#2A332F",
        input: "#1A211F",
        ring: "#C92A2A",
        /** Extra-muted labels (spec) */
        faint: "#73807B"
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        glow: "0 0 24px -4px rgba(201, 42, 42, 0.28)",
        "glow-sm": "0 0 16px -6px rgba(201, 42, 42, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;

