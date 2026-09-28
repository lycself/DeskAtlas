import type { Metadata } from "next";

import { AdminLogin } from "@/app/components/AdminLogin";

export const metadata: Metadata = { title: "管理员登录" };

export default function AdminLoginPage() {
  return <AdminLogin />;
}
