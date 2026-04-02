/**
 * Next.js 16 generates `.next/dev/types/validator.ts` importing `ResolvingMetadata` from `next/types.js`.
 * Under `moduleResolution: "NodeNext"`, that path resolves to the runtime stub `next/types.js` (no exports),
 * so TypeScript reports missing exports. Re-export the real types from Next's declaration entry.
 */
declare module "next/types.js" {
  export type { ResolvingMetadata, ResolvingViewport } from "next";
}
