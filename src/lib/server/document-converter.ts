import "server-only";

const CONVERTAPI_ENDPOINT = "https://v2.convertapi.com/convert/docx/to/pdf";
const DEFAULT_TIMEOUT_MS = 60_000;

export class PdfConverterError extends Error {
  code: string;
  publicMessage: string;

  constructor(code: string, publicMessage: string) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export class PdfConverterUnavailable extends PdfConverterError {}
export class PdfConverterFailed extends PdfConverterError {}

export function isPdfConverterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CONVERTAPI_TOKEN?.trim());
}

export async function convertDocxToPdf(buffer: Buffer, fileName: string): Promise<Buffer> {
  const token = process.env.CONVERTAPI_TOKEN?.trim();
  if (!token) {
    throw new PdfConverterUnavailable(
      "PDF_CONVERTER_NOT_CONFIGURED",
      "PDF 변환 서비스가 설정되지 않았습니다. (CONVERTAPI_TOKEN 미설정)",
    );
  }

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  formData.append("File", blob, fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(CONVERTAPI_ENDPOINT, {
      method: "POST",
      body: formData,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new PdfConverterFailed(
        "PDF_CONVERTER_TIMEOUT",
        `PDF 변환이 ${DEFAULT_TIMEOUT_MS / 1000}초 안에 완료되지 않았습니다.`,
      );
    }
    throw new PdfConverterFailed(
      "PDF_CONVERTER_UNREACHABLE",
      `PDF 변환 서비스에 연결할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    throw new PdfConverterFailed(
      response.status === 401 || response.status === 403
        ? "PDF_CONVERTER_AUTH_FAILED"
        : "PDF_CONVERTER_FAILED",
      summarizeConvertApiError(response.status, rawBody),
    );
  }

  const json = (await response.json().catch(() => null)) as ConvertApiResponse | null;
  const file = Array.isArray(json?.Files) ? json.Files[0] : undefined;
  if (!file || typeof file.FileData !== "string" || !file.FileData) {
    throw new PdfConverterFailed(
      "PDF_CONVERTER_INVALID_RESPONSE",
      "PDF 변환 응답에 파일 데이터가 없습니다.",
    );
  }

  return Buffer.from(file.FileData, "base64");
}

type ConvertApiFile = {
  FileName?: string;
  FileExt?: string;
  FileSize?: number;
  FileData?: string;
};

type ConvertApiResponse = {
  ConversionCost?: number;
  Files?: ConvertApiFile[];
};

function summarizeConvertApiError(status: number, body: string): string {
  const fallback = `PDF 변환 실패 (HTTP ${status}): ${body.slice(0, 200) || "(응답 본문 없음)"}`;
  if (!body.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(body) as { Code?: string; Message?: string };
    if (parsed && (parsed.Code || parsed.Message)) {
      const code = parsed.Code ? `${parsed.Code} ` : "";
      return `PDF 변환 실패 (HTTP ${status}): ${code}${parsed.Message ?? ""}`.trim();
    }
  } catch {
    // ignore JSON parse error
  }
  return fallback;
}
