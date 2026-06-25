type Props = {
  children: string;
  tone?: "default" | "success" | "warning" | "muted" | "accent";
};

export default function Badge({ children, tone = "default" }: Props) {
  return <span className={`mn-badge mn-badge--${tone}`}>{children}</span>;
}
