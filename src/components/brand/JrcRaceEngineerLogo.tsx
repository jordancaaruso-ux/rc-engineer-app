import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/brand/jrc-race-engineer-logo.svg";

type Props = {
  className?: string;
  /** Use on above-the-fold hero (e.g. login) for LCP. */
  priority?: boolean;
  /**
   * Use in the sidebar: scales to 100% of the container width (h follows aspect ratio).
   * Default: compact height for inline use (e.g. login).
   */
  fullWidth?: boolean;
};

/**
 * JRC RACE ENGINEER wordmark (brand asset in `public/brand/`).
 */
export function JrcRaceEngineerLogo({ className, priority, fullWidth }: Props) {
  return (
    <Image
      src={LOGO_SRC}
      alt="JRC Race Engineer"
      width={1160}
      height={440}
      unoptimized
      className={cn(
        "block object-contain object-left leading-none",
        fullWidth ? "h-auto w-full" : "h-8 w-auto max-w-full sm:h-9",
        className
      )}
      priority={priority}
      sizes={
        fullWidth
          ? "(min-width: 768px) 224px, min(100vw, 20rem)"
          : "(max-width: 768px) 200px, 220px"
      }
    />
  );
}
