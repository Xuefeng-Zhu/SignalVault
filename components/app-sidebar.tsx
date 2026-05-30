"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  matchExact?: boolean;
}

const navItems: NavItem[] = [
  { href: "/companies", label: "Dashboard", icon: "dashboard", matchExact: true },
  { href: "/companies", label: "Companies", icon: "business" },
  { href: "/scans", label: "Scans", icon: "radar" },
  { href: "/claims", label: "Claims", icon: "gavel" },
  { href: "/evidence-vault", label: "Evidence Vault", icon: "inventory_2" },
  { href: "/integrations", label: "Integrations", icon: "hub" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.matchExact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-sidebar-width flex-col border-r border-white/10 bg-sidebar px-4 py-5 text-white">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/20 text-primary-foreground shadow-[0_12px_24px_-16px_rgba(91,61,245,0.9)]">
          <span className="material-symbols-outlined text-[20px]">shield_lock</span>
        </div>
        <div>
          <p className="font-page-title text-[20px] font-bold tracking-[-0.03em] text-white">
            SignalVault
          </p>
          <p className="font-label-caps text-label-caps uppercase tracking-[0.2em] text-white/40">
            Market Intelligence
          </p>
        </div>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item);

          return (
            <Link
              key={`${item.label}-${item.icon}`}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-body-md transition-all duration-200",
                active
                  ? "bg-white/10 font-semibold text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white",
              )}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 font-section-title text-section-title font-semibold text-white">
            AM
          </div>
          <div>
            <p className="text-body-md font-semibold text-white">Alex Morgan</p>
            <p className="text-body-sm text-white/60">Enterprise Plan</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
