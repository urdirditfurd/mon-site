import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-slate-100 text-slate-700",
        success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
        warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
        danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
        info: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200",
        muted: "bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200",
        navy: "bg-[#0B1F33]/10 text-[#0B1F33] ring-1 ring-inset ring-[#0B1F33]/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
