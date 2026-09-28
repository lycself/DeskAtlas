import Image from "next/image";
import Link from "next/link";

import logo from "@/logo.png";

type BrandProps = {
  compact?: boolean;
  href?: string;
  /** Accessible name for the link; defaults to the public home page. */
  label?: string;
};

export function Brand({ compact = false, href = "/", label = "DeskAtlas 首页" }: BrandProps) {
  return (
    <Link href={href} className={`brand ${compact ? "compact" : ""}`} aria-label={label}>
      <span className="brand-logo-wrap">
        <Image src={logo} alt="" className="brand-logo" priority />
      </span>
      <span className="brand-copy">
        <strong>DeskAtlas</strong>
        {!compact && <small>研究生工位管理</small>}
      </span>
    </Link>
  );
}
