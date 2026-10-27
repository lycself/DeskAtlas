import type { SelectOption } from "@/app/components/Select";

export function seatOptions(seats: Array<{ id: string; label: string }>, creation = false): SelectOption[] {
  const sorted = [...seats].sort((a, b) => Number(b.id.startsWith("virtual:")) - Number(a.id.startsWith("virtual:")) || a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
  const options = sorted.filter((seat) => !creation || seat.id !== "virtual:未被分配").map((seat) => {
    const parts = seat.label.split(" · ");
    return { value: String(seat.id), label: seat.id.startsWith("virtual:") ? seat.label.replace("虚拟工位", "人员分组") : `${parts[1]} · 工位 ${parts.slice(2).join(" · ")}`, group: seat.id.startsWith("virtual:") ? "人员分组" : `${parts[0]} · ${parts[1]} 房间` };
  });
  return creation ? [{ value: "", label: "未被分配（稍后安排）", group: "人员分组" }, ...options] : options;
}
