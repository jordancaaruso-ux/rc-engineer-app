"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppleLogo } from "@phosphor-icons/react";

/** Official Google "G" mark — multicolor, reads cleanly on the dark surface button. */
export function GoogleMark(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.892 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * The Apple logo. On Apple's own devices (the iPhone app, Safari on a Mac) it is the system's
 * glyph, which is Apple's artwork itself: Apple's design rules ask Sign in with Apple buttons to
 * carry that. Elsewhere (Windows, Android) the system font has no such glyph, so a drawn one
 * stands in. Decided after mount; the sign-in buttons only render client-side anyway.
 */
export function AppleMark({ size = 18 }: { size?: number }): ReactNode {
  const [systemGlyph, setSystemGlyph] = useState(false);
  useEffect(() => {
    setSystemGlyph(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent));
  }, []);
  if (systemGlyph) {
    return (
      <span
        aria-hidden="true"
        style={{
          fontFamily: "-apple-system, BlinkMacSystemFont, system-ui",
          fontSize: size + 2,
          lineHeight: 1,
        }}
      >
        {""}
      </span>
    );
  }
  return <AppleLogo size={size} weight="fill" aria-hidden="true" />;
}
