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
        background: "#0B0F0E",
        foreground: "#E8F0ED",
        card: {
          DEFAULT: "#131917",
          foreground: "#E8F0ED"
        },
        primary: {
          DEFAULT: "#C92A2A",
          foreground: "#F8F9FA"
        },
        secondary: {
          DEFAULT: "#121716",
          foreground: "#E8F0ED"
        },
        muted: {
          DEFAULT: "#121716",
          foreground: "#A7B3AF"
        },
        accent: {
          DEFAULT: "#2563EB",
          foreground: "#F8F9FA"
        },
        destructive: "#7A1E1E",
        border: "#1F2624",
        input: "#161C1A",
        ring: "#C92A2A",
        /** Extra-muted labels (spec) */
        faint: "#6B7572"
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

