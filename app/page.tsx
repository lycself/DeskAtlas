import type { Metadata } from "next";

import { StudentPortal } from "./components/StudentPortal";

export const metadata: Metadata = { title: "工位地图" };

export default function HomePage() {
  return <StudentPortal />;
}
