import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  success?: boolean;
};

export default function PrimaryButton({ children, fullWidth, success, className = "", ...rest }: Props) {
  return (
    <button
      type="button"
      className={`mn-btn mn-btn--primary ${fullWidth ? "mn-btn--full" : ""} ${success ? "mn-btn--success" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
