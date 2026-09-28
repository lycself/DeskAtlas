import type { Metadata } from "next";

import { AdminPortal } from "@/app/components/AdminPortal";

export const metadata: Metadata = { title: "管理端" };

export default function AdminPage() {
  return <AdminPortal />;
}
