import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  padding?: "normal" | "compact";
};

export default function Card({ children, className = "", padding = "normal" }: Props) {
  return (
    <div className={`mn-card mn-card--${padding} ${className}`.trim()}>
      {children}
    </div>
  );
}
