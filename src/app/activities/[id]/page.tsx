import { AoRoutePage } from "@/features/activities-opportunities/ui/route-page";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AoRoutePage kind="activity" mode="detail" id={id} />;
}
