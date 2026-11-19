import type { ComponentProps } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

// A plain <Link> renders an inline <a>, and browsers ignore vertical margins
// on inline elements, so a parent's `space-y-*` cannot separate a stack of
// full-width buttons wrapped in links. Making the link a block lets it.
export function BlockLink({
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return <Link className={cn("block", className)} {...props} />;
}
