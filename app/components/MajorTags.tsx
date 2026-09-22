import { majorStyles } from "@/app/lib/majors";

export function MajorTags({ names = [], compact = false }: { names?: string[]; compact?: boolean }) {
  if (!names.length) return <span className="major-tag unspecified">教研中心未填写</span>;
  if (compact && names.length > 1) return <span className="major-tag shared" title={`教研中心：${names.join("、")}`} aria-label={`教研中心：${names.join("、")}`}>多教研中心</span>;
  return <>{names.map((name) => <span key={name} title={`教研中心：${name}`} aria-label={`教研中心：${name}`}
    className={`major-tag ${majorStyles[name]?.className ?? "unspecified"}`}>
    {compact ? majorStyles[name]?.shortName ?? name : name}
  </span>)}</>;
}
