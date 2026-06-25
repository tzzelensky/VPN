import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
};

export default function SecondaryButton({ children, fullWidth, className = "", ...rest }: Props) {
  return (
    <button
      type="button"
      className={`mn-btn mn-btn--secondary ${fullWidth ? "mn-btn--full" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
