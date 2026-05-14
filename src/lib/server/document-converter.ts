import "server-only";

const CONVERTAPI_ENDPOINT = "https://v2.convertapi.com/convert/docx/to/pdf";
const CLOUDCONVERT_API_ENDPOINT = "https://api.cloudconvert.com/v2";
const DEFAULT_TIMEOUT_MS = 60_000;
const CLOUDCONVERT_POLL_INTERVAL_MS = 2_000;

type PdfConverterProvider = "convertapi" | "cloudconvert";

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
  if (selectedPdfConverter(env) === "cloudconvert") {
    return Boolean(env.CLOUDCONVERT_API_KEY?.trim());
  }
  return Boolean(env.CONVERTAPI_TOKEN?.trim());
}

export async function convertDocxToPdf(buffer: Buffer, fileName: string): Promise<Buffer> {
  if (selectedPdfConverter() === "cloudconvert") {
    return convertDocxToPdfWithCloudConvert(buffer, fileName);
  }
  return convertDocxToPdfWithConvertApi(buffer, fileName);
}

function selectedPdfConverter(env: NodeJS.ProcessEnv = process.env): PdfConverterProvider {
  return env.PDF_CONVERTER_PROVIDER?.trim().toLowerCase() === "cloudconvert" ? "cloudconvert" : "convertapi";
}

async function convertDocxToPdfWithConvertApi(buffer: Buffer, fileName: string): Promise<Buffer> {
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

  const response = await fetchWithTimeout(CONVERTAPI_ENDPOINT, {
    method: "POST",
    body: formData,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

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
  if (!file?.FileData) {
    throw new PdfConverterFailed(
      "PDF_CONVERTER_INVALID_RESPONSE",
      "PDF 변환 응답에 파일 데이터가 없습니다.",
    );
  }

  return Buffer.from(file.FileData, "base64");
}

async function convertDocxToPdfWithCloudConvert(buffer: Buffer, fileName: string): Promise<Buffer> {
  const token = process.env.CLOUDCONVERT_API_KEY?.trim();
  if (!token) {
    throw new PdfConverterUnavailable(
      "PDF_CONVERTER_NOT_CONFIGURED",
      "PDF 변환 서비스가 설정되지 않았습니다. (CLOUDCONVERT_API_KEY 미설정)",
    );
  }

  const job = await cloudConvertRequest<CloudConvertJobResponse>(token, "/jobs", {
    method: "POST",
    body: JSON.stringify({
      tasks: {
        "import-file": { operation: "import/upload" },
        "convert-file": {
          operation: "convert",
          input: "import-file",
          input_format: "docx",
          output_format: "pdf",
          filename: fileName.replace(/\.docx$/i, ".pdf"),
        },
        "export-file": {
          operation: "export/url",
          input: "convert-file",
        },
      },
    }),
  });

  const uploadTask = findCloudConvertTask(job.data, "import-file");
  const form = uploadTask?.result?.form;
  if (!form?.url || !form.parameters) {
    throw new PdfConverterFailed(
      "PDF_CONVERTER_INVALID_RESPONSE",
      "CloudConvert 업로드 URL 응답을 확인할 수 없습니다.",
    );
  }

  const uploadForm = new FormData();
  Object.entries(form.parameters).forEach(([key, value]) => {
    uploadForm.append(key, value);
  });
  uploadForm.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    fileName,
  );

  const uploadResponse = await fetchWithTimeout(form.url, {
    method: "POST",
    body: uploadForm,
    cache: "no-store",
  });
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text().catch(() => "");
    throw new PdfConverterFailed(
      "PDF_CONVERTER_UPLOAD_FAILED",
      `CloudConvert 파일 업로드 실패 (HTTP ${uploadResponse.status}): ${body.slice(0, 200)}`,
    );
  }

  const finishedJob = await waitForCloudConvertJob(token, job.data.id);
  const exportTask = findCloudConvertTask(finishedJob, "export-file");
  const outputUrl = exportTask?.result?.files?.[0]?.url;
  if (!outputUrl) {
    throw new PdfConverterFailed(
      "PDF_CONVERTER_INVALID_RESPONSE",
      "CloudConvert PDF 다운로드 URL을 확인할 수 없습니다.",
    );
  }

  const pdfResponse = await fetchWithTimeout(outputUrl, { cache: "no-store" });
  if (!pdfResponse.ok) {
    const body = await pdfResponse.text().catch(() => "");
    throw new PdfConverterFailed(
      "PDF_CONVERTER_DOWNLOAD_FAILED",
      `CloudConvert PDF 다운로드 실패 (HTTP ${pdfResponse.status}): ${body.slice(0, 200)}`,
    );
  }

  return Buffer.from(await pdfResponse.arrayBuffer());
}

type ConvertApiFile = {
  FileData?: string;
};

type ConvertApiResponse = {
  Files?: ConvertApiFile[];
};

type CloudConvertJobResponse = {
  data: CloudConvertJob;
};

type CloudConvertJob = {
  id: string;
  status?: string;
  tasks?: CloudConvertTask[];
};

type CloudConvertTask = {
  id: string;
  name: string;
  status?: string;
  message?: string;
  result?: {
    form?: {
      url?: string;
      parameters?: Record<string, string>;
    };
    files?: Array<{
      url?: string;
    }>;
  };
};

async function cloudConvertRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithTimeout(`${CLOUDCONVERT_API_ENDPOINT}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new PdfConverterFailed(
      response.status === 401 || response.status === 403
        ? "PDF_CONVERTER_AUTH_FAILED"
        : "PDF_CONVERTER_FAILED",
      summarizeCloudConvertError(response.status, body),
    );
  }

  return (await response.json()) as T;
}

async function waitForCloudConvertJob(token: string, jobId: string): Promise<CloudConvertJob> {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = (await cloudConvertRequest<CloudConvertJobResponse>(token, `/jobs/${jobId}`)).data;
    if (job.status === "finished") {
      return job;
    }
    if (job.status === "error") {
      const failedTask = job.tasks?.find((task) => task.status === "error");
      throw new PdfConverterFailed(
        "PDF_CONVERTER_FAILED",
        `CloudConvert 변환 실패: ${failedTask?.message ?? "작업이 오류 상태로 종료되었습니다."}`,
      );
    }
    await sleep(CLOUDCONVERT_POLL_INTERVAL_MS);
  }
  throw new PdfConverterFailed(
    "PDF_CONVERTER_TIMEOUT",
    `CloudConvert 변환이 ${DEFAULT_TIMEOUT_MS / 1000}초 안에 완료되지 않았습니다.`,
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new PdfConverterFailed(
        "PDF_CONVERTER_TIMEOUT",
        `PDF 변환 요청이 ${DEFAULT_TIMEOUT_MS / 1000}초 안에 완료되지 않았습니다.`,
      );
    }
    throw new PdfConverterFailed(
      "PDF_CONVERTER_UNREACHABLE",
      `PDF 변환 서비스에 연결할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function findCloudConvertTask(job: CloudConvertJob, name: string): CloudConvertTask | undefined {
  return job.tasks?.find((task) => task.name === name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeConvertApiError(status: number, body: string): string {
  const fallback = `PDF 변환 실패 (HTTP ${status}): ${body.slice(0, 200) || "(응답 본문 없음)"}`;
  if (!body.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(body) as { Code?: string; Message?: string };
    if (parsed?.Code || parsed?.Message) {
      const code = parsed.Code ? `${parsed.Code} ` : "";
      return `PDF 변환 실패 (HTTP ${status}): ${code}${parsed.Message ?? ""}`.trim();
    }
  } catch {
    // ignore JSON parse error
  }
  return fallback;
}

function summarizeCloudConvertError(status: number, body: string): string {
  const fallback = `CloudConvert 변환 실패 (HTTP ${status}): ${body.slice(0, 200) || "(응답 본문 없음)"}`;
  if (!body.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    if (parsed?.code || parsed?.message) {
      const code = parsed.code ? `${parsed.code} ` : "";
      return `CloudConvert 변환 실패 (HTTP ${status}): ${code}${parsed.message ?? ""}`.trim();
    }
  } catch {
    // ignore JSON parse error
  }
  return fallback;
}
