"use client";
import { publicEnv } from "../config/publicEnvironment.ts";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { resolveBuildIdentity } from "../utils/buildIdentity";

const buildIdentity = resolveBuildIdentity(
  publicEnv.NEXT_PUBLIC_CYBERGOLD_APP_COMMIT
);

export function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="site-footer border-t border-white/10 text-[#eef2f7]">
      <div className="bg-[rgb(27_27_27/0.55)] backdrop-blur-[12px] backdrop-saturate-[155%]">
        <div className="mx-auto grid w-full max-w-7xl items-start gap-8 px-4 py-7 text-xs font-normal md:grid-cols-2 md:px-8">
          <div className="space-y-2 text-slate-300">
            <p>{t("copyright")}</p>
            <p>{t("location")}</p>
          </div>

          <div className="space-y-2 text-slate-300">
            <div className="flex items-baseline gap-1">
              <h2 className="text-xs font-semibold text-white">{t("contactHeading")}</h2>
              <a
                href="mailto:contact@cybergold.io"
                className="transition-colors hover:text-gold-cg"
              >
                contact@cybergold.io
              </a>
            </div>
            <p>
              {t("deployedVersion")}{" "}
              {buildIdentity ? (
                <Link
                  href={buildIdentity.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={buildIdentity.commit}
                  aria-label={t("commitLinkLabel", { commit: buildIdentity.commit })}
                  className="font-mono text-white underline decoration-white/40 underline-offset-4 transition-colors hover:text-gold-cg"
                  data-testid="deployed-commit"
                >
                  {buildIdentity.shortCommit}
                </Link>
              ) : (
                <span data-testid="deployed-commit-unavailable">
                  {t("buildUnavailable")}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
