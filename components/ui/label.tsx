import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Standard shadcn/ui label. Implemented as a plain `<label>` to avoid adding
 * `@radix-ui/react-label`; styling matches the shadcn "default" preset.
 */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
