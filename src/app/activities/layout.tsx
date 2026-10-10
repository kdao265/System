import type { ReactNode } from "react";
import { AoAccessLayout } from "@/features/activities-opportunities/ui/access-layout";

export default function Layout({ children }: { children: ReactNode }) {
  return <AoAccessLayout>{children}</AoAccessLayout>;
}
