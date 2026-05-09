import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName, primaryButtonClassName } from "./ButtonLink";

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" }) {
  return (
    <button
      type={type}
      className={cn(variant === "primary" ? primaryButtonClassName() : outlineButtonClassName(), className)}
      {...props}
    />
  );
}
