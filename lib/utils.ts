import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names, resolving conflicting utilities.
 * Standard shadcn/ui helper used by generated components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
