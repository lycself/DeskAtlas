export const targetLabels: Record<string, string> = { room: "房间", seat: "工位", student: "学生", teacher: "教师", major: "教研中心", application: "申请", smtp: "邮件配置", import: "数据导入", backup: "备份", admin: "管理员", report: "报表", arrangement: "工位安排", database: "数据库" };
const actions: Record<string, string> = { "room.layout_updated": "更新房间布局", "layout.import_border_repaired": "修复导入布局边界", "remarks.migrated": "整理历史备注", "seat.note_cleaned": "整理工位备注", "student.deleted": "移除学生记录", "student.program_level_repaired": "校正培养层次", "survey.layout_repaired": "校正房间布局", "survey.metadata_completed": "补全用房信息", "survey.occupancy_confirmed": "核对工位占用", "survey.perimeter_repaired": "校正房间边界", "survey.room_majors_imported": "同步房间教研中心", "survey.walls_restored": "恢复房间墙体", "room.created": "创建房间", "room.updated": "更新房间信息", "layout.draft_saved": "保存布局草稿", "layout.draft_discarded": "放弃布局草稿", "layout.published": "发布房间布局", "seat.status_updated": "更新工位状态", "student.created": "录入学生", "student.updated": "更新学生资料", "student.note_migrated": "整理学生备注", "assignment.moved": "调整学生工位", "assignment.released": "释放学生工位", "major.created": "添加教研中心", "major.updated": "更新教研中心", "teacher.created": "添加教师", "teacher.updated": "更新教师资料", "smtp.updated": "更新邮件设置", "import.committed": "导入工位表", "latest.imported": "同步最新安排", "survey.imported": "导入用房安排", "backup.exported": "导出备份", "backup.created": "创建备份", "backup.deleted": "删除备份", "backup.restored": "从备份恢复", "admin.password_changed": "修改管理员密码", "excel.exported": "导出 Excel", "application.approved": "同意工位申请", "application.rejected": "拒绝工位申请" };
export const actionLabel = (action: string) => actions[action] ?? `${targetLabels[action.split(".")[0]] ?? "系统"}记录变更`;
const fields: Record<string, string> = { name: "姓名 / 名称", student_no: "学号", adviser: "导师", enrollment_year: "年级", program_level: "培养层次", major_id: "教研中心", room_id: "房间", seat_id: "工位", student_id: "学生", note: "备注", admin_status: "工位状态", is_active: "启用状态", is_archived: "归档状态", is_published: "发布状态", major_names: "所属教研中心", floor: "楼层", building: "楼栋", items: "布局元素", seat_count: "工位数量", host: "邮件服务器", port: "端口", security: "加密方式", username: "用户名", title: "职称", role: "中心职务", created_rooms: "新增房间", created_seats: "新增工位", created_students: "新增学生", created_assignments: "新增分配", updated: "更新记录", equipment: "设备", skipped: "跳过记录", unresolved: "待核对记录", scope: "导出范围", tables: "数据表", counts: "记录统计", source_remarks: "来源备注", reason: "原因", status: "状态", rejection_reason: "拒绝原因" };
function display(value: unknown): string {
  if (value == null || value === "") return "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.every((item) => typeof item === "string") ? value.join("、") || "无" : `${value.length} 项`;
  if (typeof value === "object") return `${Object.keys(value).length} 项记录（可展开技术详情）`;
  return ({ active: "可使用", reserved: "保留", maintenance: "维修中", pending: "待审批", approved: "已同意", rejected: "已拒绝", starttls: "STARTTLS", ssl: "SSL/TLS", none: "不加密" } as Record<string, string>)[String(value)] ?? String(value);
}
export function auditChanges(before: unknown, after: unknown) {
  const flatten = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object") return {};
    const { original_data, reviewed_data, ...rest } = value as Record<string, unknown>;
    const person = reviewed_data ?? original_data;
    return person && typeof person === "object" ? { ...rest, ...person as Record<string, unknown> } : rest;
  };
  const left = flatten(before), right = flatten(after);
  return (Object.keys(right).length ? Object.keys(right) : Object.keys(left)).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).map((key) => ({ key, label: fields[key] ?? "其他信息", before: display(left[key]), after: display(right[key]) }));
}
