import { majorStyles } from "@/app/lib/majors";

export function MajorTags({ names = [], compact = false }: { names?: string[]; compact?: boolean }) {
  if (!names.length) return <span className="major-tag unspecified">专业未填写</span>;
  if (compact && names.length > 1) return <span className="major-tag shared" title={names.join("、")}>多专业</span>;
  return <>{names.map((name) => <span key={name} title={name}
    className={`major-tag ${majorStyles[name]?.className ?? "unspecified"}`}>
    {compact ? majorStyles[name]?.shortName ?? name : name}
  </span>)}</>;
}
