"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

const PUBLIC_PATHS = ["/", "/login"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((path) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path),
  );

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className="ml-sidebar-width flex min-h-screen flex-col">
        <AppTopbar />
        <main className="flex-1 px-container-margin py-xl">{children}</main>
      </div>
    </div>
  );
}
