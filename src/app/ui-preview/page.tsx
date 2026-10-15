import { notFound } from "next/navigation";
import { MailConsole } from "@/components/mail-console";

export const dynamic = "force-dynamic";

export default function PreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <MailConsole preview />;
}
