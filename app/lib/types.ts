export type SeatState = "available" | "pending" | "occupied" | "unavailable";

export type Occupant = {
  name: string;
  adviser?: string | null;
  enrollment_year?: number | null;
  program_level?: string | null;
  major?: string | null;
};

export type SeatInfo = {
  id: string;
  code: string;
  admin_status: string;
  display_state: SeatState;
  note?: string | null;
  occupant?: Occupant | null;
};

export type LayoutItem = {
  id: string;
  type: "seat" | "door" | "window" | "aisle" | "column" | "equipment" | "label";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  seat?: SeatInfo;
};

export type Room = {
  id: number;
  name: string;
  building?: string | null;
  floor?: string | null;
  description?: string | null;
  canvas_width: number;
  canvas_height: number;
  is_published: boolean;
  is_archived: boolean;
  published_at?: string | null;
  items: LayoutItem[];
  seat_counts: Partial<Record<SeatState, number>>;
};

export type Major = {
  id: number;
  name: string;
  sort_order?: number;
  is_active?: boolean;
};

export type Bootstrap = {
  years: number[];
  program_levels: string[];
  majors: Major[];
  rooms: Room[];
};

export type Application = {
  id: number;
  status: string;
  student_no: string;
  original_data: Record<string, string | number>;
  reviewed_data?: Record<string, string | number> | null;
  rejection_reason?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
  seat: { id: string; code: string; room_id: number; room_name: string };
};

export type Student = {
  id: number;
  student_no?: string | null;
  name: string;
  adviser?: string | null;
  email?: string | null;
  enrollment_year?: number | null;
  program_level?: string | null;
  major_id?: number | null;
  major?: string | null;
  is_complete: boolean;
  current_assignment?: {
    assignment_id: number;
    seat_id: string;
    seat_code: string;
    room_id: number;
    room_name: string;
  } | null;
  history: Array<{
    id: number;
    room: string;
    seat: string;
    started_at: string;
    ended_at?: string | null;
    source: string;
    note?: string | null;
  }>;
};

