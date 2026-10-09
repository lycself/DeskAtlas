"use client";

import type { Bootstrap } from "@/app/lib/types";

export type StudentFormValues = {
  name: string;
  student_no: string;
  adviser: string;
  enrollment_year: string;
  program_level: string;
  major_id: string;
  note: string;
};

export const emptyStudentForm: StudentFormValues = {
  name: "", student_no: "", adviser: "", enrollment_year: "", program_level: "", major_id: "", note: "",
};

export function studentEmail(studentNo: string): string {
  const trimmed = studentNo.trim();
  return trimmed ? `${trimmed}@stu.xmu.edu.cn` : "";
}

/** The email is derived from the student number, so it is shown as text rather than a field. */
export function DerivedEmail({ studentNo }: { studentNo: string }) {
  const email = studentEmail(studentNo);
  return (
    <p className="derived-email">
      <span>学生邮箱</span>
      <strong>{email || "填写学号后自动生成"}</strong>
    </p>
  );
}

type Props = {
  form: StudentFormValues;
  onChange: (patch: Partial<StudentFormValues>) => void;
  options: Pick<Bootstrap, "years" | "program_levels" | "majors"> | null;
  /** Public applications require every field; administrators may leave gaps to fill later. */
  required?: boolean;
  adviserHint?: string;
};

/** One field layout for every place a student record is entered or edited. */
export function StudentFormFields({ form, onChange, options, required = false, adviserHint }: Props) {
  const blank = required ? null : <option value="">待补全</option>;
  return (
    <>
      <div className="field-grid two">
        <label><span>姓名</span><input required maxLength={80} value={form.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
        <label><span>学号</span><input required={required} value={form.student_no} onChange={(event) => onChange({ student_no: event.target.value })} /></label>
      </div>
      <label>
        <span>导师全名</span>
        <input required={required} placeholder="请填写导师完整姓名" value={form.adviser} onChange={(event) => onChange({ adviser: event.target.value })} />
        {adviserHint && <small>{adviserHint}</small>}
      </label>
      <div className="field-grid three">
        <label><span>年级</span><select required={required} value={form.enrollment_year} onChange={(event) => onChange({ enrollment_year: event.target.value })}>{blank}{options?.years.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>培养层次</span><select required={required} value={form.program_level} onChange={(event) => onChange({ program_level: event.target.value })}>{blank}{options?.program_levels.map((level) => <option key={level}>{level}</option>)}</select></label>
        <label><span>教研中心</span><select required={required} value={form.major_id} onChange={(event) => onChange({ major_id: event.target.value })}>{blank}{options?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select></label>
      </div>
      <DerivedEmail studentNo={form.student_no} />
      {!required && <label><span>学生备注</span><textarea rows={3} maxLength={1000} value={form.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="记录休学、出国、离校等学生情况" /></label>}
    </>
  );
}
