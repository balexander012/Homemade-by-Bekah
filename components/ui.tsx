import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ tone = "primary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className={`hb-btn hb-btn--app hb-btn--${tone} ${className}`} {...props} />;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field">{label}{children}</label>;
}
export function Heading({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <header className="heading"><div className="stack compact">{detail && <p className="eyebrow">{detail}</p>}<h1>{title}</h1></div>{children}</header>;
}
export function Brand() {
  return <span>
    <img className="brand-logo brand-light" src="/brand/hb-horizontal.svg" alt="Homemade by Bekah" width="190" />
    <img className="brand-logo brand-dark" src="/brand/hb-horizontal-reverse.svg" alt="Homemade by Bekah" width="190" />
  </span>;
}
export function Status({ children }: { children: ReactNode }) {
  const status = typeof children === "string" ? children : "";
  const variant = /Approved|Completed|Captured|Tested/.test(status) ? "done" :
    /Overdue|Retake|Cancelled/.test(status) ? "late" :
    /Rest|Timer running|Draft/.test(status) ? "proof" : /Oven/.test(status) ? "bake" : "prep";
  return <span className={`hb-status hb-status--${variant}`}>{children}</span>;
}
export function message(cause: unknown) {
  if (cause && typeof cause === "object" && "issues" in cause && Array.isArray(cause.issues)) {
    return cause.issues.map((issue) => `${issue.path.join(".") ? `${issue.path.join(".")} — ` : ""}${issue.message}`).join(" ");
  }
  return cause instanceof Error ? cause.message : "Please try again.";
}
