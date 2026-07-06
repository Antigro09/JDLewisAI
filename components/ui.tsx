import * as React from "react";
import { cn } from "@/lib/utils";

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
  }
>(({ className, variant = "primary", size = "md", ...props }, ref) => {
  const variants: Record<string, string> = {
    primary:
      "bg-ember-accent-solid text-white shadow-ember-bubble hover:brightness-105 disabled:opacity-60",
    secondary:
      "border border-ember-border bg-ember-surface text-ember-text hover:bg-ember-subtle",
    ghost: "text-ember-muted hover:bg-ember-subtle",
    danger: "bg-ember-danger text-white hover:brightness-105",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3.5 text-[13.5px]",
    md: "h-10 px-5 text-sm",
  };
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background,transform,filter] duration-150 ease-ember-spring active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-xl border border-ember-border bg-ember-bg px-3.5 text-sm text-ember-text outline-none transition-shadow placeholder:text-ember-faint focus:border-ember-accent focus:ring-2 focus:ring-brand-500/20",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-xl border border-ember-border bg-ember-bg px-3.5 py-2.5 text-sm text-ember-text outline-none transition-shadow placeholder:text-ember-faint focus:border-ember-accent focus:ring-2 focus:ring-brand-500/20",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 rounded-xl border border-ember-border bg-ember-bg px-2.5 text-sm text-ember-text outline-none focus:border-ember-accent focus:ring-2 focus:ring-brand-500/20",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1 block text-sm font-medium text-ember-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-ember-border border-t-ember-accent",
        className,
      )}
    />
  );
}
