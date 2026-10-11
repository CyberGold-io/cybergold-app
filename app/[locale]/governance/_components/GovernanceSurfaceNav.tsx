"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "@/i18n/navigation";
import { GOVERNANCE_SURFACES, type GovernanceSurfaceId } from "../_lib/governanceSurfaces";

type GovernanceSurfaceNavProps = {
  activeSurfaceId?: GovernanceSurfaceId;
};

export function GovernanceSurfaceNav({ activeSurfaceId }: GovernanceSurfaceNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    for (const surface of GOVERNANCE_SURFACES) {
      if (surface.href === pathname) continue;
      router.prefetch(surface.href);
    }
  }, [pathname, router]);

  return (
    <nav
      aria-label="Governance sections"
      className="mt-5 flex items-center gap-2 overflow-x-auto rounded-full border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-1"
    >
      {GOVERNANCE_SURFACES.map((surface) => {
        const active =
          activeSurfaceId === surface.id ||
          pathname === surface.href ||
          (surface.href !== "/governance" && pathname.startsWith(surface.href));
        return (
          <Link
            key={surface.id}
            href={surface.href}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all ${
              active
                ? "bg-gold-cg text-white shadow-md"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-input)] dark:hover:bg-white/10"
            }`}
          >
            {surface.label}
          </Link>
        );
      })}
    </nav>
  );
}
