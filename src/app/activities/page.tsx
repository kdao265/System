import { AoRoutePage } from "@/features/activities-opportunities/ui/route-page";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export default function Page() {
  return <AoRoutePage kind="activity" mode="list" />;
}
