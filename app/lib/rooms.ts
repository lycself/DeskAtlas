import type { Room } from "./types";

const roomCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function getFloorLabel(room: Room): string {
  const explicit = room.floor?.trim();
  if (explicit) return /^\d+$/.test(explicit) ? `${explicit}层` : explicit;

  const roomNumber = room.name.trim().match(/^(\d{3,4})/); 
  if (!roomNumber) return "未设置楼层";

  const floor = Number(roomNumber[1].slice(0, -2));
  return Number.isFinite(floor) && floor > 0 ? `${floor}层` : "未设置楼层";
}

export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((left, right) => {
    const floorOrder = roomCollator.compare(getFloorLabel(left), getFloorLabel(right));
    return floorOrder || roomCollator.compare(left.name, right.name);
  });
}

export function groupRoomsByFloor(rooms: Room[]): Array<{ floor: string; rooms: Room[] }> {
  const groups = new Map<string, Room[]>();
  for (const room of sortRooms(rooms)) {
    const floor = getFloorLabel(room);
    groups.set(floor, [...(groups.get(floor) ?? []), room]);
  }
  return [...groups].map(([floor, groupedRooms]) => ({ floor, rooms: groupedRooms }));
}
