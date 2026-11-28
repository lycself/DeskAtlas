import type { LayoutItem, Room } from "./types";

/** Matched character spans, `[start, end)` in the original text. */
export type MatchRange = [number, number];
export type Match = { score: number; ranges: MatchRange[] };

/** Case-insensitive, with full-width letters, digits and spaces read as their ASCII forms. Keeps every index in place. */
export function fold(text: string) {
  return text.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).replace(/　/g, " ").toLowerCase();
}

/**
 * Lower scores are better: 0 the whole text, 1 its start, 2 anywhere inside, 3 the characters in order
 * with gaps ("软理" finds "软物质物理", "李明" finds "李晓明"). A gapped match must stay compact, so a
 * short query never lights up scattered characters across a long text, and room or seat numbers never gap.
 */
export function fuzzyMatch(text: string, query: string): Match | null {
  const haystack = fold(text), needle = fold(query).trim();
  if (!needle) return null;
  if (haystack === needle) return { score: 0, ranges: [[0, text.length]] };
  const at = haystack.indexOf(needle);
  if (at === 0) return { score: 1, ranges: [[0, needle.length]] };
  if (at > 0) return { score: 2 + Math.min(at, 99) / 100, ranges: [[at, at + needle.length]] };
  const chars = [...needle.replace(/\s+/g, "")];
  // Numbers are codes, not words: "441" must not find "442-1".
  if (chars.length < 2 || /^[\d\s-]+$/.test(needle)) return null;
  const ranges: MatchRange[] = [];
  let from = 0;
  for (const char of chars) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return null;
    const last = ranges.at(-1);
    if (last && last[1] === index) last[1] = index + char.length; else ranges.push([index, index + char.length]);
    from = index + char.length;
  }
  const span = ranges.at(-1)![1] - ranges[0][0];
  if (span > chars.length * 3) return null;
  return { score: 3 + Math.min(span, 99) / 100, ranges };
}

// "301 12", "301-12" and "301号12号" all name seat 12 of room 301, as in the admin search.
const SEAT_QUERY = /^(?:\s*[-_·/#.:：]\s*|\s+|\s*[号室]\s*)(?:工位|座位)?\s*(\S+?)\s*号?(?:工位|座位)?$/;

/** The seat code a query names inside `roomName`, or null when the query is not "room + seat". */
export function seatCodeQuery(roomName: string, query: string): string | null {
  const text = fold(query.trim()), room = fold(roomName.trim());
  if (!room || !text.startsWith(room)) return null;
  const match = SEAT_QUERY.exec(text.slice(room.length));
  return match ? match[1] : null;
}

export type PublicHit =
  | { kind: "seat"; score: number; room: Room; item: LayoutItem }
  | { kind: "room"; score: number; room: Room; field: "name" | "detail"; text: string }
  | { kind: "person"; score: number; room: Room; item: LayoutItem; field: "name" | "adviser" | "major" }
  | { kind: "major"; score: number; name: string; rooms: number };

export type PublicResults = {
  seats: PublicHit[]; rooms: PublicHit[]; people: PublicHit[]; majors: PublicHit[];
  /** People matched in total, before the list is capped. */
  peopleTotal: number;
};

const LIMIT = { seats: 6, rooms: 6, people: 10, majors: 4 };
const byScore = (left: { score: number }, right: { score: number }) => left.score - right.score;

/**
 * Searches only what the student page already shows: room names and their details, seat numbers,
 * and the name, adviser and research centre of each seat's occupant.
 */
export function searchPublic(rooms: Room[], query: string): PublicResults {
  const empty: PublicResults = { seats: [], rooms: [], people: [], majors: [], peopleTotal: 0 };
  if (!fold(query).trim()) return empty;
  const seats: PublicHit[] = [], roomHits: PublicHit[] = [], people: PublicHit[] = [];
  const majors = new Map<string, number>();
  for (const room of rooms) {
    for (const major of room.major_names ?? []) majors.set(major, (majors.get(major) ?? 0) + 1);
    const code = room.is_virtual ? null : seatCodeQuery(room.name, query);
    const roomSeats = room.items.filter((item) => item.type === "seat" && item.seat);
    if (code !== null) {
      for (const item of roomSeats) {
        const label = fold(item.label);
        if (label.startsWith(code)) seats.push({ kind: "seat", score: label === code ? 0 : 1 + label.length / 100, room, item });
      }
    }
    const name = fuzzyMatch(room.name, query);
    const details = [room.building, room.floor, ...(room.major_names ?? [])].filter((value): value is string => !!value)
      .map((text) => ({ text, match: fuzzyMatch(text, query) })).filter((entry) => entry.match).sort((a, b) => a.match!.score - b.match!.score)[0];
    // A room found by its name outranks one found by a detail such as its research centre.
    if (name) roomHits.push({ kind: "room", score: name.score, room, field: "name", text: room.name });
    else if (details) roomHits.push({ kind: "room", score: details.match!.score + 4, room, field: "detail", text: details.text });
    for (const item of roomSeats) {
      const occupant = item.seat!.occupant;
      if (!occupant) continue;
      const fields = ([["name", occupant.name, 0], ["adviser", occupant.adviser, .5], ["major", occupant.major, 4]] as const)
        .map(([field, text, offset]) => { const match = text ? fuzzyMatch(text, query) : null; return match && { field, score: match.score + offset }; })
        .filter((entry) => entry !== null).sort(byScore)[0];
      if (fields) people.push({ kind: "person", score: fields.score, room, item, field: fields.field });
    }
  }
  const majorHits: PublicHit[] = [...majors].flatMap(([name, count]) => {
    const match = fuzzyMatch(name, query);
    return match ? [{ kind: "major" as const, score: match.score, name, rooms: count }] : [];
  });
  return {
    seats: seats.sort(byScore).slice(0, LIMIT.seats),
    rooms: roomHits.sort(byScore).slice(0, LIMIT.rooms),
    people: people.sort(byScore).slice(0, LIMIT.people),
    majors: majorHits.sort(byScore).slice(0, LIMIT.majors),
    peopleTotal: people.length,
  };
}
