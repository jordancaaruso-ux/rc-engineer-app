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
        // Driven by `globals.css` RGB triplets + `data-theme-preview` variants.
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--color-card) / <alpha-value>)",
          foreground: "rgb(var(--color-card-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          foreground: "rgb(var(--color-primary-foreground) / <alpha-value>)",
          /**
           * Yellow doing a foreground job (text, icon, stroke, tick). Identical to
           * `primary` in dark; #8A6A00 in light, where #FFD60A is 1.4:1 on the card.
           * If you are writing `text-primary` or `stroke-primary`, you want this.
           */
          ink: "rgb(var(--color-primary-ink) / <alpha-value>)",
        },
        /** Improvement green — a lap got faster. Was the literal #4FD089. */
        gain: "rgb(var(--color-gain) / <alpha-value>)",
        /** Attention, not error. Replaces the `text-amber-600 dark:text-amber-*` pairs. */
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        /** Tint that lifts a surface off its ground: white in dark, ink in light. */
        elevate: "rgb(var(--color-elevate) / <alpha-value>)",
        /**
         * Loading placeholder bars only. Tuned for perceptibility (~1.3:1 on `card`),
         * not contrast — never put text on it, and never use it as a surface.
         */
        skeleton: "rgb(var(--color-skeleton) / <alpha-value>)",
        secondary: {
          DEFAULT: "rgb(var(--color-secondary) / <alpha-value>)",
          foreground: "rgb(var(--color-secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--color-muted) / <alpha-value>)",
          foreground: "rgb(var(--color-muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          foreground: "rgb(var(--color-accent-foreground) / <alpha-value>)",
        },
        destructive: "rgb(var(--color-destructive) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        input: "rgb(var(--color-input) / <alpha-value>)",
        ring: "rgb(var(--color-ring) / <alpha-value>)",
        /** Extra-muted labels (spec) */
        faint: "rgb(var(--color-faint) / <alpha-value>)",
        /** Cool flat panels (runna-style neutrals; see globals.css) */
        "surface-runna": {
          DEFAULT: "rgb(var(--color-surface-runna) / <alpha-value>)",
          deep: "rgb(var(--color-surface-runna-deep) / <alpha-value>)",
          inset: "rgb(var(--color-surface-runna-inset) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem"
      },
      fontFamily: {
        /** Inter — body, nav, page titles, hero PanelTitle, controls */
        sans: ["var(--font-ui)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono-jb)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        glow: "0 0 24px -4px rgb(var(--glow-shadow-rgb) / 0.28)",
        "glow-sm": "0 0 16px -6px rgb(var(--glow-shadow-rgb) / 0.22)",
      },
    }
  },
  plugins: []
};

export default config;
