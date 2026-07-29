"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  LayoutDashboard,
  Receipt,
  Landmark,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/",
    label: "Tableau de bord",
    description: "KPIs temps réel",
    icon: LayoutDashboard,
  },
  {
    href: "/facturation",
    label: "Facturation",
    description: "Devis → Facture → Relance",
    icon: Receipt,
  },
  {
    href: "/notes-de-frais",
    label: "Notes de frais",
    description: "OCR & validation",
    icon: Wallet,
  },
  {
    href: "/tresorerie",
    label: "Trésorerie",
    description: "Banque & lettrage",
    icon: Landmark,
  },
  {
    href: "/journal",
    label: "Journal",
    description: "PCG & écritures",
    icon: BookOpen,
  },
  {
    href: "/collaboration",
    label: "Collaboration",
    description: "Espace expert",
    icon: Users,
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-slate-200/80 bg-[#0B1F33] text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#C8A45A]/20 ring-1 ring-[#C8A45A]/40">
          <Building2 className="h-4.5 w-4.5 text-[#C8A45A]" strokeWidth={1.75} />
        </div>
        <div>
          <p className="font-display text-lg leading-none tracking-tight text-white">
            LedgerFlow
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Comptabilité modulaire</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Les 6 piliers
        </p>
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  active ? "text-[#C8A45A]" : "text-slate-400 group-hover:text-slate-200",
                )}
                strokeWidth={1.75}
              />
              <span>
                <span className="block text-sm font-medium leading-tight">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="rounded-lg bg-white/5 px-3 py-3 ring-1 ring-white/10">
          <p className="text-xs font-medium text-slate-200">Sprint fondation</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            UI + schéma DB + facturation mock. CSV bancaire ensuite.
          </p>
        </div>
      </div>
    </aside>
  );
}
