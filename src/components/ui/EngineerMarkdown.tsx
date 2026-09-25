import { Children, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { sheetLinkHandleFromHref, type SheetLinkTarget, type SheetLinks } from "@/lib/engineer/sheetLinks";

/**
 * Renders Engineer prose as Markdown. The Engineer's prompt is written in
 * Markdown and it bolds technical terms, cites files in `code`, and uses
 * bullet / numbered lists — surfaces that dropped the raw string into a
 * `whitespace-pre-wrap` div showed literal `**`, `*`, and backticks.
 *
 * Visual North Star: prose stays Sora (inherit font-sans); bold → semibold,
 * inline code / filenames → mono chip, lists match the existing bullet styling.
 * Yellow stays for links (the only actionable inline element) — never for
 * emphasis, which the KB uses heavily.
 *
 * A setup-change link (`[two changes I can't identify](#sheet-4f9k2m)`, sheetLinks.ts) draws as a
 * highlighted phrase that opens those boxes on the driver's sheet — when the caller passes what it
 * opens. Anywhere else, or for a handle the answer has no target for, it is just its words.
 */

const INLINE_CODE = "rounded bg-muted/60 px-1 py-[1px] type-machine text-[0.92em] text-foreground/90";

function PlainLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary-ink underline underline-offset-2 hover:text-primary-ink/80"
    >
      {children}
    </a>
  );
}

const blockComponents: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }) => <li className="break-words leading-snug">{children}</li>,
  h1: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  h4: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
  hr: () => <hr className="border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  code: ({ children }) => <code className={INLINE_CODE}>{children}</code>,
  a: ({ children, href }) => <PlainLink href={href}>{children}</PlainLink>,
};

/** Inline variant: unwraps paragraphs so it can live inside an existing <p>/<li>. */
const inlineComponents: Components = {
  ...blockComponents,
  p: ({ children }) => <>{children}</>,
};

/**
 * The link's words with its sheet icon glued to the last word, so the icon never wraps onto a line
 * of its own (an inline icon is a break opportunity; a nowrap span around word + icon is not).
 */
function withIconOnLastWord(children: ReactNode, icon: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  const last = parts[parts.length - 1];
  if (typeof last !== "string") return <>{parts}<span className="whitespace-nowrap">{icon}</span></>;
  const cut = last.trimEnd().lastIndexOf(" ");
  return (
    <>
      {parts.slice(0, -1)}
      {cut >= 0 ? last.slice(0, cut + 1) : null}
      <span className="whitespace-nowrap">
        {cut >= 0 ? last.slice(cut + 1) : last}
        {icon}
      </span>
    </>
  );
}

/**
 * The `a` renderer with setup-change links wired in. An `<a>` rather than a button so the phrase
 * wraps across lines like the words around it; the fragment href never navigates.
 */
function withSheetLinks(
  base: Components,
  links: SheetLinks | undefined,
  onOpen: ((handle: string, target: SheetLinkTarget) => void) | undefined
): Components {
  return {
    ...base,
    a: ({ children, href }) => {
      const handle = sheetLinkHandleFromHref(href);
      if (!handle) return <PlainLink href={href}>{children}</PlainLink>;
      const target = links?.[handle.toLowerCase()];
      if (!target || !onOpen) return <>{children}</>;
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onOpen(handle.toLowerCase(), target);
          }}
          data-sheet-link={handle}
          className="tap-active rounded-[3px] bg-primary/35 px-0.5 font-semibold text-foreground underline decoration-primary-ink decoration-[1.5px] underline-offset-[3px] [box-decoration-break:clone] hover:bg-primary/50"
        >
          {withIconOnLastWord(
            children,
            <FileText className="ml-0.5 inline-block size-3.5 -translate-y-px align-middle text-primary-ink" strokeWidth={2.25} aria-hidden />
          )}
        </a>
      );
    },
  };
}

export function EngineerMarkdown({
  children,
  className,
  inline = false,
  sheetLinks,
  onOpenSheetLink,
}: {
  children: string;
  className?: string;
  /** Strip block wrappers so it renders inside an existing paragraph or list item. */
  inline?: boolean;
  /** What each setup-change link in this answer opens; without it the links read as plain words. */
  sheetLinks?: SheetLinks;
  onOpenSheetLink?: (handle: string, target: SheetLinkTarget) => void;
}) {
  const text = children ?? "";
  const components = withSheetLinks(inline ? inlineComponents : blockComponents, sheetLinks, onOpenSheetLink);
  if (inline) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
        allowedElements={["strong", "em", "del", "code", "a", "p", "br"]}
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    );
  }
  return (
    <div className={cn("break-words [&>*+*]:mt-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
