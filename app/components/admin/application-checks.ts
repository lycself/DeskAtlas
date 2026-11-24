import type { Application, Bootstrap, Room } from "@/app/lib/types";

export type Teacher = { id: number; name: string; title?: string | null; role?: string | null; major_id?: number | null; is_active?: boolean };
export type Check = { ok: boolean; text: string; hint?: string };

/** What an administrator would otherwise look up by hand before approving an application. */
export function applicationChecks(application: Application, data: Record<string, string | number>, options: Pick<Bootstrap, "majors"> | null,
  teachers: Teacher[], room: Room | undefined, pending: Application[]): Check[] {
  const majorName = (id: unknown) => options?.majors.find((major) => String(major.id) === String(id))?.name;
  const adviser = String(data.adviser ?? "").trim();
  const applicantMajor = majorName(data.major_id);
  const checks: Check[] = [];

  const teacher = teachers.find((entry) => entry.name === adviser && entry.is_active !== false);
  if (teacher) {
    checks.push({ ok: true, text: `导师 ${adviser} 在教师名单中${majorName(teacher.major_id) ? `（${majorName(teacher.major_id)}）` : ""}` });
    if (teacher.major_id && applicantMajor && String(teacher.major_id) !== String(data.major_id)) {
      checks.push({ ok: false, text: `导师属于${majorName(teacher.major_id)}，申请填写的是${applicantMajor}` });
    }
  } else {
    const similar = adviser ? teachers.filter((entry) => entry.is_active !== false && entry.name[0] === adviser[0] && entry.name !== adviser).slice(0, 4) : [];
    checks.push({ ok: false, text: `导师“${adviser || "未填写"}”不在教师名单中`, hint: similar.length ? `同姓教师：${similar.map((entry) => entry.name).join("、")}` : undefined });
  }

  const roomMajors = room?.major_names ?? [];
  if (room && applicantMajor && roomMajors.length) {
    checks.push(roomMajors.includes(applicantMajor)
      ? { ok: true, text: `${applicantMajor}与房间 ${room.name} 的教研中心一致` }
      : { ok: false, text: `申请人属于${applicantMajor}，房间 ${room.name} 属于${roomMajors.join("、")}` });
  }

  const duplicates = pending.filter((entry) => entry.id !== application.id && entry.student_no === application.student_no);
  if (duplicates.length) checks.push({ ok: false, text: `同一学号还有 ${duplicates.length} 份待审批申请` });
  return checks;
}
