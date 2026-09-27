import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
  href?: string;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  href,
  children,
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-semibold uppercase tracking-wider transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cyber-black disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs rounded-sm",
    md: "px-5 py-2.5 text-sm rounded",
    lg: "px-7 py-3.5 text-base rounded-md",
  };

  const variantStyles = {
    primary:
      "bg-neon-cyan text-cyber-black hover:bg-cyan-300 focus:ring-neon-cyan neon-glow-cyan font-bold",
    secondary:
      "bg-neon-pink text-white hover:bg-pink-600 focus:ring-neon-pink neon-glow-pink",
    outline:
      "border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan focus:ring-neon-cyan",
    ghost:
      "text-zinc-400 hover:text-white hover:bg-cyber-surface/60 focus:ring-zinc-500",
  };

  const combinedClass = cn(baseStyles, sizeStyles[size], variantStyles[variant], className);

  if (href) {
    return (
      <Link href={href} className={combinedClass}>
        {children}
      </Link>
    );
  }

  return (
    <button className={combinedClass} {...props}>
      {children}
    </button>
  );
}
