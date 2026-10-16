import { notFound } from "next/navigation";
import { PreviewValidationConsole } from "@/components/preview-validation-console";

export const dynamic = "force-dynamic";

export default function ValidationPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <PreviewValidationConsole />;
}
