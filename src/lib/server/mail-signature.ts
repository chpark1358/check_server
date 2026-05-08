import "server-only";

const DEFAULT_SIGNATURE_BUCKET = "public-assets";
const DEFAULT_SIGNATURE_PATH = "mail/jiransoft_sign_next.png";

export function getMailSignaturePublicUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const bucket = process.env.MAIL_SIGNATURE_BUCKET || DEFAULT_SIGNATURE_BUCKET;
  const objectPath = process.env.MAIL_SIGNATURE_PATH || DEFAULT_SIGNATURE_PATH;

  if (!baseUrl || !bucket || !objectPath) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(
    objectPath,
  )}`;
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
