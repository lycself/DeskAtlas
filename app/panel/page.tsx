import type { Metadata } from "next";

import { PanelApp } from "@/app/components/PanelApp";

export const metadata: Metadata = { title: "桌面面板" };

export default function PanelPage() {
  return <PanelApp />;
}
