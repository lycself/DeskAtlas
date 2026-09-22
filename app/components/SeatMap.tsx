"use client";

import dynamic from "next/dynamic";
import type { LayoutItem, Room } from "@/app/lib/types";

const SeatCanvas = dynamic(() => import("./SeatCanvas"), {
  ssr: false,
  loading: () => <div className="map-loading">正在准备平面图…</div>,
});

type Props = {
  room: Room;
  items?: LayoutItem[];
  editable?: boolean;
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect?: (item: LayoutItem | null, additive?: boolean) => void;
  onItemsChange?: (items: LayoutItem[]) => void;
  onSelectMany?: (ids: string[]) => void;
};

export function SeatMap(props: Props) {
  return <SeatCanvas {...props} />;
}
