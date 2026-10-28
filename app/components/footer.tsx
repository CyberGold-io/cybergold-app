"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FiGithub, FiLinkedin } from "react-icons/fi";
import { FaXTwitter } from "react-icons/fa6";
import { publicEnv } from "../config/publicEnvironment.ts";
import { resolveBuildIdentity } from "../utils/buildIdentity";

const buildIdentity = resolveBuildIdentity(publicEnv.NEXT_PUBLIC_CYBERGOLD_APP_COMMIT);
const socials = [
  { href: "https://github.com/CyberGold-io", label: "CyberGold on GitHub", icon: FiGithub },
  { href: "https://www.linkedin.com/company/100201492/", label: "CyberGold on LinkedIn", icon: FiLinkedin },
  { href: "https://x.com/CyberGold_io", label: "CyberGold on X (Twitter)", icon: FaXTwitter },
];

export function Footer() {
  const t = useTranslations("Footer");
  return <footer className="site-footer cg-footer">
    <div className="cg-footer-surface">
      <div className="cg-footer-inner">
        <div className="cg-footer-main">
          <div className="cg-footer-brand">
            {/* Preserve the brand image's intrinsic size and 2x descriptor. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/logo-light.png" srcSet="/branding/logo-light@2x.png 2x" alt="CyberGold" />
            <p>{t("location")}</p>
          </div>
          <div className="cg-footer-contact">
            <h2>{t("contactHeading")}</h2>
            <a href="mailto:#">contact@cybergold.io</a>
          </div>
          <ul className="cg-footer-socials" aria-label="CyberGold social media">
            {socials.map(({ href, label, icon: Icon }) => <li key={href}>
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                <Icon aria-hidden="true" focusable="false" />
              </a>
            </li>)}
          </ul>
        </div>
        <div className="cg-footer-metadata">
          <p className="cg-footer-copyright">{t("copyright")}</p>
          <div className="cg-footer-credits">
            <p>{t("maintainedBy")}</p>
          </div>
          <div className="cg-footer-deployment">
            <p>{t("deployedVersion")}{" "}{buildIdentity
                ? <Link className="cg-footer-version" href={buildIdentity.url} target="_blank" rel="noopener noreferrer" title={buildIdentity.commit}
                    aria-label={t("commitLinkLabel", { commit: buildIdentity.commit })} data-testid="deployed-commit">
                    {buildIdentity.shortCommit}
                  </Link>
                : <span data-testid="deployed-commit-unavailable">{t("buildUnavailable")}</span>}
            </p>
            <div className="cg-footer-source">
              <p><Link href="/source" prefetch={false}>{t("sourceCode")}</Link></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>;
}
