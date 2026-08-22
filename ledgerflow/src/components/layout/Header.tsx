"use client";

import { Bell, ChevronDown, Command, Search } from "lucide-react";
import { mockCompany } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#F5F7FA]/90 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-6 py-3.5">
        <div>
          <h1 className="font-display text-xl tracking-tight text-[#0B1F33]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm transition hover:border-slate-300 md:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Recherche globale…</span>
            <kbd className="ml-6 inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>

          <Button variant="secondary" size="sm" className="gap-1.5">
            <span className="max-w-[140px] truncate">{mockCompany.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </Button>

          <Button variant="secondary" size="icon" aria-label="Notifications">
            <Bell className="h-4 w-4 text-slate-600" />
          </Button>
        </div>
      </div>
    </header>
  );
}
