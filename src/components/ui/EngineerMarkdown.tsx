import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
 */

const INLINE_CODE = "rounded bg-muted/60 px-1 py-[1px] font-mono text-[0.92em] text-foreground/90";

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
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
};

/** Inline variant: unwraps paragraphs so it can live inside an existing <p>/<li>. */
const inlineComponents: Components = {
  ...blockComponents,
  p: ({ children }) => <>{children}</>,
};

export function EngineerMarkdown({
  children,
  className,
  inline = false,
}: {
  children: string;
  className?: string;
  /** Strip block wrappers so it renders inside an existing paragraph or list item. */
  inline?: boolean;
}) {
  const text = children ?? "";
  if (inline) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={inlineComponents}
        allowedElements={["strong", "em", "del", "code", "a", "p", "br"]}
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    );
  }
  return (
    <div className={cn("break-words [&>*+*]:mt-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={blockComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
