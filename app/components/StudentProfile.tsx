import type { Occupant } from "@/app/lib/types";

type Props = {
  person: Occupant & { student_no?: string | null; email?: string | null };
  location?: string;
  compact?: boolean;
};

export function StudentProfile({ person, location, compact = false }: Props) {
  const fields = [
    ["导师", person.adviser],
    ["年级", person.enrollment_year ? `${person.enrollment_year} 级` : null],
    ["培养层次", person.program_level],
    ["教研中心", person.major],
    ...("email" in person ? [["邮箱", person.email]] : []),
  ];
  return <div className={`student-profile ${compact ? "compact-profile" : ""}`}>
    <header className="profile-heading">
      <div><h2>{person.name}</h2>{location && <p>{location}</p>}{"student_no" in person && <small>{person.student_no || "学号待补全"}</small>}</div>
    </header>
    <dl className="profile-fields">{fields.map(([label, value]) => <div key={label} className={label === "邮箱" ? "profile-wide" : ""}><dt>{label}</dt><dd className={!value ? "profile-missing" : ""}>{value || "待补全"}</dd></div>)}</dl>
  </div>;
}
