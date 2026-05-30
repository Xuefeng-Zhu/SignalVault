"use client";

import * as React from "react";

export interface ContentFallbackProps {
  /** The HTML tag to render. Defaults to a span. */
  as?: "h1" | "h2" | "p" | "span" | "div";
  /** Text shown if the real content has not rendered within `timeoutMs`. */
  placeholder: string;
  /** ClassName applied to the rendered element in both states. */
  className?: string;
  /** Milliseconds to wait before substituting the placeholder. */
  timeoutMs?: number;
  /** The real content. Server-rendered so it is present immediately. */
  children: React.ReactNode;
}

/**
 * Resilient wrapper for required landing-page text (Requirement 2.2).
 *
 * The real `children` are rendered directly so they appear in the initial
 * server-rendered markup. After `timeoutMs` (default 5s) the component checks
 * whether the element actually rendered visible text; if it did not, it swaps
 * in `placeholder` text in place of that element while the rest of the page
 * continues to render.
 */
export function ContentFallback({
  as = "span",
  placeholder,
  className,
  timeoutMs = 5000,
  children,
}: ContentFallbackProps) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const text = ref.current?.textContent?.trim() ?? "";
      if (text.length === 0) {
        setShowPlaceholder(true);
      }
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [timeoutMs]);

  // A ref callback works across all intrinsic tags without the
  // tag-specific LegacyRef union mismatch a typed object ref would cause.
  const setRef = React.useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);

  const Tag = as;

  return (
    <Tag
      ref={setRef}
      className={className}
      data-fallback={showPlaceholder ? "true" : undefined}
    >
      {showPlaceholder ? placeholder : children}
    </Tag>
  );
}
