import type { LayoutItem, Major, Room } from "@/app/lib/types";

export function VirtualRoomPlan({ room, majors, query, onSelect, selectedId, context = "student" }: {
  room: Room; majors: Major[]; query: string; onSelect: (item: LayoutItem) => void; selectedId?: string | null;
  context?: "student" | "admin";
}) {
  const normalized = query.trim().toLowerCase();
  const groups = new Map<string, LayoutItem[]>(majors.map((major) => [major.name, []]));
  for (const item of room.items) {
    if (item.type !== "seat" || !item.seat?.occupant) continue;
    const person = item.seat.occupant;
    if (normalized && !`${item.label} ${person.name} ${person.adviser ?? ""} ${person.major ?? ""}`.toLowerCase().includes(normalized)) continue;
    const group = person.major || "未设置教研组";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const visibleGroups = [...groups].filter(([, items]) => !normalized || items.length);

  return <div className="virtual-plan" aria-label={`${room.name}虚拟位置图`}>
    <header><strong>虚拟位置</strong><span>按教研组排列 · {room.items.some((item) => item.type === "seat") ? context === "admin" ? "点击位置管理学生" : "点击姓名查看资料" : "展示位置不可申请"}</span></header>
    {visibleGroups.length ? visibleGroups.map(([group, items], groupIndex) => <section className="virtual-plan-group" key={group}>
      <h3>{group}<small>{items.length} 人</small></h3>
      <div className="virtual-position-grid">{items.length ? items.map((item) => <button type="button" key={item.id}
        className={`virtual-position ${selectedId === item.id ? "selected" : ""}`}
        aria-pressed={selectedId === item.id} onClick={() => onSelect(item)}>
        <small>虚拟位置 {item.label}</small>
        <strong>{item.seat!.occupant!.name}</strong>
        <span>{item.seat!.occupant!.adviser ? `导师：${item.seat!.occupant!.adviser}` : "导师未设置"}</span>
      </button>) : Array.from({ length: 4 }, (_, index) => <div className="virtual-position placeholder" key={index}>
        <small>虚拟位置 {groupIndex + 1}-{index + 1}</small>
        <strong>暂未安排</strong>
        <span>仅作分组展示</span>
      </div>)}</div>
    </section>) : <p className="virtual-plan-empty">{normalized ? "没有匹配的人员" : "该分组目前没有人员"}</p>}
    <footer>虚拟位置仅用于展示人员分组，不代表实际座位，也不可申请。</footer>
  </div>;
}
