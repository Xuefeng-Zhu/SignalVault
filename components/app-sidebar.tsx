"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  match?: "exact" | "nestedOnly" | "inclusive";
}

const navItems: NavItem[] = [
  { href: "/companies", label: "Dashboard", icon: "dashboard", match: "exact" },
  { href: "/companies", label: "Companies", icon: "business", match: "nestedOnly" },
  { href: "/scans", label: "Scans", icon: "radar", match: "inclusive" },
  { href: "/claims", label: "Claims", icon: "gavel", match: "inclusive" },
  { href: "/evidence-vault", label: "Evidence Vault", icon: "inventory_2", match: "inclusive" },
  { href: "/integrations", label: "Integrations", icon: "hub", match: "inclusive" },
  { href: "/settings", label: "Settings", icon: "settings", match: "inclusive" },
];

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  if (item.match === "nestedOnly") return pathname.startsWith(`${item.href}/`);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-sidebar-width flex-col border-r border-white/10 bg-sidebar px-5 py-5 text-white">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5b3df5] text-white shadow-[0_18px_36px_-24px_rgba(91,61,245,0.95)]">
          <span
            className="material-symbols-outlined text-[18px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            security
          </span>
        </div>
        <div>
          <p className="font-page-title text-[22px] font-semibold tracking-[-0.03em] text-white">
            SignalVault
          </p>
          <p className="font-page-title text-[9px] font-medium uppercase tracking-[0.3em] text-white/45">
            Market Intelligence
          </p>
        </div>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1.5">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item);

          return (
            <Link
              key={`${item.label}-${item.icon}`}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90",
              )}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
              >
                {item.icon}
              </span>
              <span className="font-page-title text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
            AM
          </div>
          <div>
            <p className="text-sm font-medium text-white">Alex Morgan</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
              Enterprise Plan
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
