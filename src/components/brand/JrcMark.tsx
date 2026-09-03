import Image from "next/image";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

const SRC = {
  yellow: "/brand/jrc-mark-yellow.svg",
  white: "/brand/jrc-mark-white.svg",
  ink: "/brand/jrc-mark-ink.svg",
} as const;

type Props = {
  /**
   * `yellow` for brand/hero surfaces (icon, login); `white` for working chrome (nav);
   * `ink` for the yellow ground — the launch splash and the app icon, where the mark
   * is the dark shape and yellow is the field.
   */
  variant?: keyof typeof SRC;
  /** Control the height via a Tailwind class, e.g. `h-5` (width follows the 731:241 ratio). */
  className?: string;
  /** Set on above-the-fold hero (login) for LCP. */
  priority?: boolean;
  alt?: string;
};

/**
 * The JRC mark — the brand glyph in `public/brand/`. Yellow = brand/hero;
 * white = persistent chrome (keeps yellow meaning "action" per VISUAL_NORTH_STAR);
 * ink = on the yellow field. Replaces the retired red→blue `JrcRaceEngineerLogo`
 * (Known Gap #2).
 *
 * All three files are generated from one geometry by `scripts/generate-brand-lockups.mjs`
 * — change the glyph in `public/brand/jrc-mark-yellow.svg` and re-run it.
 */
export function JrcMark({ variant = "yellow", className, priority, alt = PRODUCT_NAME }: Props) {
  return (
    <Image
      src={SRC[variant]}
      alt={alt}
      width={731}
      height={241}
      unoptimized
      priority={priority}
      className={cn("block w-auto object-contain", className)}
    />
  );
}
