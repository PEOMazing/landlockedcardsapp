"use client";
import { useRouter } from "next/navigation";
import CollectrImport from "@/components/CollectrImport";

// Server-rendered collection page needs a client wrapper so the importer can
// refresh the dashboard after cards land.
export default function CollectionRefresh() {
  const router = useRouter();
  return <CollectrImport onDone={() => router.refresh()} />;
}
