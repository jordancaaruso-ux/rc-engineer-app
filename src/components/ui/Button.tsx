import type { ButtonHTMLAttributes } from "react";
import { buttonLinkClassName, type ButtonVariant } from "./ButtonLink";

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonLinkClassName(variant, className)} {...props} />;
}
