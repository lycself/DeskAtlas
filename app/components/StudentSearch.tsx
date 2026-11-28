"use client";

import { Armchair, DoorOpen, Layers, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import { CommandPalette, Highlight, type CommandEntry, type CommandGroup } from "@/app/components/CommandPalette";
import { getFloorLabel } from "@/app/lib/rooms";
import { searchPublic, type PublicHit } from "@/app/lib/search";
import type { LayoutItem, Room, SeatState } from "@/app/lib/types";

const seatStateLabel: Record<SeatState, string> = { available: "可申请", pending: "审核中", occupied: "已占用", unavailable: "不可使用" };

function seatPlace(room: Room, item: LayoutItem) {
  return room.is_virtual ? room.name : `${room.name} · ${item.label} 号工位`;
}

/**
 * Student search over the rooms already on the page, so nothing beyond the public data is searched
 * and no request is made per keystroke. Choosing a seat or a person opens their room and marks the seat.
 */
export function StudentSearch({ rooms, onSeat, onRoom, onMajor, onClose }: {
  rooms: Room[];
  onSeat: (room: Room, item: LayoutItem) => void;
  onRoom: (room: Room) => void;
  onMajor: (major: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo<CommandGroup[]>(() => {
    const found = searchPublic(rooms, query);
    const entry = (hit: PublicHit): CommandEntry => {
      if (hit.kind === "seat") {
        const state = hit.item.seat!.display_state;
        return {
          key: `seat-${hit.item.id}`, icon: Armchair, title: seatPlace(hit.room, hit.item),
          meta: hit.item.seat!.occupant ? `使用人：${hit.item.seat!.occupant.name}` : undefined,
          badge: <span className={`state-label ${state}`}><i />{seatStateLabel[state]}</span>,
          run: () => onSeat(hit.room, hit.item),
        };
      }
      if (hit.kind === "room") {
        const seats = hit.room.items.filter((item) => item.type === "seat").length;
        const details = [getFloorLabel(hit.room), (hit.room.major_names ?? []).join("、")].filter(Boolean).join(" · ");
        return {
          key: `room-${hit.room.id}`, icon: DoorOpen,
          title: hit.field === "name" ? <Highlight text={hit.room.name} term={query} fuzzy /> : hit.room.name,
          meta: hit.field === "detail" ? <Highlight text={details} term={hit.text} /> : details || undefined,
          badge: <small>{hit.room.is_virtual ? `${seats} 人` : `${hit.room.seat_counts.available ?? 0} 空位 / ${seats} 工位`}</small>,
          run: () => onRoom(hit.room),
        };
      }
      if (hit.kind === "person") {
        const occupant = hit.item.seat!.occupant!;
        const meta = [occupant.adviser && `导师 ${occupant.adviser}`, occupant.major].filter(Boolean).join(" · ");
        const matched = hit.field === "adviser" ? occupant.adviser! : hit.field === "major" ? occupant.major! : "";
        return {
          key: `person-${hit.item.id}`, icon: UserRound,
          title: hit.field === "name" ? <Highlight text={occupant.name} term={query} fuzzy /> : occupant.name,
          meta: meta && (matched ? <Highlight text={meta} term={matched} /> : meta),
          badge: <small>{seatPlace(hit.room, hit.item)}</small>,
          run: () => onSeat(hit.room, hit.item),
        };
      }
      return {
        key: `major-${hit.name}`, icon: Layers, title: <Highlight text={hit.name} term={query} fuzzy />,
        meta: "只看这个教研中心的房间", badge: <small>{hit.rooms} 间房间</small>,
        run: () => onMajor(hit.name),
      };
    };
    const people = found.peopleTotal > found.people.length ? `学生 · 前 ${found.people.length} 位，共 ${found.peopleTotal} 位` : "学生";
    // The group holding the closest match comes first, so Enter opens what the query most likely meant.
    return ([["工位", found.seats], ["房间", found.rooms], [people, found.people], ["教研中心", found.majors]] as const)
      .filter(([, hits]) => hits.length)
      .map(([label, hits]) => ({ label, best: hits[0].score, entries: hits.map(entry) }))
      .sort((left, right) => left.best - right.best);
  }, [rooms, query, onSeat, onRoom, onMajor]);

  return <CommandPalette
    label="搜索工位" placeholder="搜索房间、工位、姓名、导师或教研中心"
    groups={groups} onQuery={setQuery} onClose={onClose}
    idle={<>输入房间号、姓名、导师或教研中心，不必输全，例如“软理”能找到“软物质物理”。<br />查找工位时输入“房间号 工位号”，例如 301 12。</>}
    empty={(text) => <>没有找到与“{text}”相关的房间或人员。<br />查找工位时输入“房间号 工位号”，例如 301 12。</>}
    tip="工位：输入“房间号 工位号”，如 301 12"
  />;
}
