"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex max-w-full", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 rounded-md bg-[#0B1F33] px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg group-hover:block"
      >
        {content}
      </span>
    </span>
  );
}
