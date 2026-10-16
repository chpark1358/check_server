import type { NextRequest } from "next/server";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ApiError, apiOk, isRecord, readJsonObject, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  PdfConverterError,
  PdfConverterUnavailable,
  convertDocxToPdf,
  isPdfConverterEnabled,
} from "@/lib/server/document-converter";
import {
  buildDocumentDisplayFileName,
  buildDocumentStorageKey,
  documentContentType,
  uploadDocumentObject,
} from "@/lib/server/document-storage";
import { loadEngineerSignatureBuffer } from "@/lib/server/engineer-signatures";
import { inferDocumentServerModel } from "@/lib/server-model";
import { isRetiredEngineerName } from "@/lib/engineer-roster";
import { normalizeCheckResult } from "@/lib/server/check-result";
import { CHECK_RAW_PATHS, checkFieldIssue, isCheckFieldUnknown, pickCheckValue, readCheckBoolean, type CheckFieldKey, type CheckResultQuality } from "@/lib/check-result-quality";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DocumentFileMeta = {
  fileName: string;
  size: number;
  downloadUrl: string;
};

type DocumentResponse = {
  id: string;
  companyName: string;
  serial: string;
  createdAt: string;
  expiresAt: string;
  docx: DocumentFileMeta;
  pdf: (DocumentFileMeta & { status: "success" }) | null;
  pdfStatus: PdfStatus;
};

type PdfStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

type GeneratedDocumentRow = {
  id: string;
  created_at: string;
  expires_at: string;
};

type ReportContext = {
  companyName: string;
  serial: string;
  productName: string;
  engineerName: string;
  engineerSignatureName: string;
  opinion: string;
  checkDate: string;
  lastReboot: string;
  dockerVersion: string;
  licenseSummary: string;
  agentVersionText: string;
  osInfo: string;
  serverModel: string;
  cpuUsage: string;
  memTotalText: string;
  memActualText: string;
  loadSummary: string;
  diskRoot: string;
  diskHome: string;
  diskStorage: string;
  monthlyReportStatus: string;
  backupStatusText: string;
  hrSyncEnabled: boolean | null;
  hrSyncStatus: string;
  hrSyncDb: string;
  hrSyncCombined: string;
  securityStatus: string;
  agentWin: string;
  agentMac: string;
  statuses: Array<[string, string, string]>;
  flags: ReportFlags;
  raw: Record<string, unknown>;
  quality: CheckResultQuality;
  manualFlagKeys: string[];
};

type ReportFlags = {
  agent: boolean | null;
  mail: boolean | null;
  web: boolean | null;
  httpd: boolean | null;
  mysqld: boolean | null;
  ntp: boolean | null;
  iptables: boolean | null;
  firewall: boolean | null;
  backup: boolean | null;
  monthlyReport: boolean | null;
  hrSyncEnabled: boolean | null;
};

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    await enforceRateLimit(`document-check-report:${auth.user.id}`, 10, 60_000);

    const body = await readJsonObject(request);
    const context = buildReportContext(body);
    const output = isRecord(body.output) ? body.output : {};
    const includePdf = output.pdf !== false;

    const docxBuffer = await buildDocx(context, auth.supabase);
    const generatedAt = new Date();
    const docxFileName = buildDocumentDisplayFileName(context.companyName, generatedAt, "docx");

    let pdfBuffer: Buffer | null = null;
    let pdfFileName: string | null = null;
    let pdfStatus: PdfStatus = { ok: true };
    let storedPdfStatus: "success" | "failed" | "unavailable" | "not_requested" = "not_requested";
    let pdfErrorSummary: string | null = null;

    if (includePdf) {
      try {
        pdfFileName = buildDocumentDisplayFileName(context.companyName, generatedAt, "pdf");
        pdfBuffer = await convertDocxToPdf(docxBuffer, docxFileName);
        storedPdfStatus = "success";
      } catch (error) {
        const { code, message } = describePdfConverterError(error);
        pdfStatus = { ok: false, code, message };
        storedPdfStatus = error instanceof PdfConverterUnavailable ? "unavailable" : "failed";
        pdfErrorSummary = message;
        pdfBuffer = null;
        pdfFileName = null;
        console.error(
          JSON.stringify({
            level: "warn",
            message: "check_report_pdf_conversion_failed",
            code,
            detail: message,
          }),
        );
      }
    } else {
      storedPdfStatus = "not_requested";
    }

    const documentId = crypto.randomUUID();
    const docxStorageKey = buildDocumentStorageKey(auth.user.id, documentId, "docx");
    await uploadDocumentObject(auth.supabase, docxStorageKey, docxBuffer, documentContentType("docx"));

    let pdfStorageKey: string | null = null;
    if (pdfBuffer && pdfFileName) {
      pdfStorageKey = buildDocumentStorageKey(auth.user.id, documentId, "pdf");
      await uploadDocumentObject(auth.supabase, pdfStorageKey, pdfBuffer, documentContentType("pdf"));
    }

    const inserted = await insertGeneratedDocumentRow(auth.supabase, {
      id: documentId,
      createdBy: auth.user.id,
      companyName: context.companyName,
      serial: context.serial,
      engineerName: context.engineerName,
      docxPath: docxStorageKey,
      pdfPath: pdfStorageKey,
      pdfStatus: storedPdfStatus,
      pdfErrorSummary,
    });

    const docxDownloadUrl = `/api/documents/${documentId}/download?type=docx`;
    const pdfDownloadUrl = pdfStorageKey ? `/api/documents/${documentId}/download?type=pdf` : null;

    await writeAuditLog(auth.supabase, auth.user, "document.check_report.generate", "document", documentId, {
      requestId,
      companyName: context.companyName,
      serial: context.serial,
      pdfStatus: storedPdfStatus,
      missingFieldCount: context.quality.missingFields.length,
      invalidFieldCount: context.quality.invalidFields.length,
      manualFlagKeys: context.manualFlagKeys,
    });

    const documentResponse: DocumentResponse = {
      id: documentId,
      companyName: context.companyName,
      serial: context.serial,
      createdAt: inserted.created_at,
      expiresAt: inserted.expires_at,
      docx: {
        fileName: docxFileName,
        size: docxBuffer.byteLength,
        downloadUrl: docxDownloadUrl,
      },
      pdf:
        pdfBuffer && pdfFileName && pdfDownloadUrl
          ? {
              fileName: pdfFileName,
              size: pdfBuffer.byteLength,
              downloadUrl: pdfDownloadUrl,
              status: "success",
            }
          : null,
      pdfStatus,
    };

    return apiOk(requestId, {
      document: documentResponse,
      pdfConverterEnabled: isPdfConverterEnabled(),
    });
  });
}

function describePdfConverterError(error: unknown): { code: string; message: string } {
  if (error instanceof PdfConverterUnavailable) {
    return { code: "PDF_CONVERTER_NOT_CONFIGURED", message: error.publicMessage };
  }
  if (error instanceof PdfConverterError) {
    return { code: error.code, message: error.publicMessage };
  }
  return {
    code: "PDF_CONVERSION_UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "알 수 없는 오류",
  };
}

async function insertGeneratedDocumentRow(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  input: {
    id: string;
    createdBy: string;
    companyName: string;
    serial: string;
    engineerName: string;
    docxPath: string;
    pdfPath: string | null;
    pdfStatus: "success" | "failed" | "unavailable" | "not_requested";
    pdfErrorSummary: string | null;
  },
): Promise<GeneratedDocumentRow> {
  const { data, error } = await supabase
    .from("generated_documents")
    .insert({
      id: input.id,
      created_by: input.createdBy,
      company_name: input.companyName,
      serial: input.serial,
      engineer_name: input.engineerName,
      docx_path: input.docxPath,
      pdf_path: input.pdfPath,
      pdf_status: input.pdfStatus,
      pdf_error_summary: input.pdfErrorSummary,
    })
    .select("id, created_at, expires_at")
    .single<GeneratedDocumentRow>();
  if (error || !data) {
    throw new ApiError(
      500,
      "GENERATED_DOCUMENT_INSERT_FAILED",
      `생성 문서 메타 저장에 실패했습니다: ${error?.message ?? "unknown"}`,
    );
  }
  return data;
}

function buildReportContext(body: Record<string, unknown>): ReportContext {
  const supplied = isRecord(body.checkResult) ? body.checkResult : {};
  const raw = isRecord(supplied.raw) ? supplied.raw : {};
  // Re-evaluate the collected source. Client metadata and normalized fallback
  // zeros/flags are not evidence of a collected measurement.
  const result = normalizeCheckResult(raw);
  const serial = stringValue(supplied.serial).toUpperCase();
  if (!/^LO\d{4,}$/.test(result.serial.trim().toUpperCase()) || serial !== result.serial.trim().toUpperCase()) {
    throw new ApiError(400, "CHECK_REPORT_SOURCE_INVALID", "원본 점검 데이터의 시리얼이 없거나 일치하지 않습니다. 점검 데이터를 다시 조회하세요.");
  }
  const quality = result.quality!;
  const manual = isRecord(body.manual) ? body.manual : {};
  const { license, versions, system, disks, flags: rawFlags, backup } = result;
  const rawLogData = parseLogData(raw.logData);
  const checkTimeText =
    stringValue(system.checkTime) ||
    pickString(raw, ["dateOfEntry", "checkTime", "checkedAt"]) ||
    pickString(rawLogData, ["time"]);
  const checkTime = checkTimeText ? new Date(checkTimeText) : new Date();
  const lastReboot = stringValue(system.lastReboot);

  const flags: ReportFlags = {
    agent: booleanValue(rawFlags.agent),
    mail: booleanValue(rawFlags.mail),
    web: booleanValue(rawFlags.web),
    httpd: booleanValue(rawFlags.httpd),
    mysqld: booleanValue(rawFlags.mysqld),
    ntp: booleanValue(rawFlags.ntp),
    iptables: booleanValue(rawFlags.iptables),
    firewall: booleanValue(rawFlags.firewall),
    backup: booleanValue(rawFlags.backup),
    monthlyReport: readCheckBoolean(pickCheckValue(raw, CHECK_RAW_PATHS.monthlyReport!)) ?? readCheckBoolean(pickCheckValue(rawLogData, ["monthlyReportStatus", "checkMonthlyReportExist"])),
    hrSyncEnabled: pickBoolean(raw, [
      "hrSyncEnabled",
      "hr_sync_enabled",
      "orgSyncEnabled",
      "org_sync_enabled",
      "sync.hrEnabled",
    ]),
  };

  const flagOverrides = isRecord(manual.flagOverrides) ? manual.flagOverrides : {};
  const manualFlagKeys: string[] = [];
  for (const key of ["agent", "mail", "web", "httpd", "mysqld", "ntp", "iptables", "firewall", "backup"] as const) {
    if (Object.hasOwn(flagOverrides, key)) {
      if (typeof flagOverrides[key] !== "boolean") throw new ApiError(400, "CHECK_REPORT_OVERRIDE_INVALID", "수동 점검 상태는 정상 또는 이상으로 지정하세요.");
      flags[key] = flagOverrides[key];
      manualFlagKeys.push(key);
    } else if (isCheckFieldUnknown(result, `flags.${key}`)) {
      flags[key] = null;
    }
  }
  if (isCheckFieldUnknown(result, "monthlyReport")) flags.monthlyReport = null;
  if (isCheckFieldUnknown(result, "hrSync")) flags.hrSyncEnabled = null;
  const fieldText = (key: CheckFieldKey, known: string) => {
    const issue = checkFieldIssue(result, key);
    return issue === "invalid" ? "확인불가" : issue === "missing" ? "미수집" : known;
  };

  const monthlyReportLatest = pickString(raw, [
    "monthlyReportLatest",
    "monthly_report_latest",
    "report.monthlyReportLatest",
  ]) || pickString(rawLogData, ["monthlyReportStatus", "checkMonthlyReportExist"]);
  const monthlyReportText = formatMonthlyReportMonth(monthlyReportLatest);

  const orgSyncRawStatus = pickString(raw, [
    "orgSyncStatus",
    "org_sync_status",
    "sync.orgSyncStatus",
  ]);
  const orgSyncLogStatus = pickString(rawLogData, ["checkOrgSync", "orgSyncStatus"]);
  const hrDbRaw =
    pickString(raw, ["orgSyncDb", "orgSyncDbFormat", "sync.orgSyncDb", "sync.dbFormat"]) ||
    extractOrgSyncDb(orgSyncRawStatus) ||
    extractOrgSyncDb(orgSyncLogStatus) ||
    pickString(rawLogData, [
      "orgSyncDb",
      "orgSyncDbFormat",
      "checkOrgSyncDb",
      "dbFormat",
      "__DB_FORMAT__",
    ]);
  const hrSyncEnabled = isCheckFieldUnknown(result, "hrSync") ? null :
    (readCheckBoolean(pickCheckValue(raw, CHECK_RAW_PATHS.hrSync!)) ?? readCheckBoolean(orgSyncLogStatus) ?? flags.hrSyncEnabled);
  flags.hrSyncEnabled = hrSyncEnabled;
  const hrSyncDb = hrSyncEnabled && hrDbRaw && hrDbRaw !== "-" ? hrDbRaw.toUpperCase() : "-";
  const hrSyncStatus = hrSyncEnabled === null ? fieldText("hrSync", "") : hrSyncEnabled ? "O" : "X";
  const hrSyncCombined =
    hrSyncEnabled && hrSyncDb !== "-" ? `${hrSyncStatus}(${hrSyncDb})` : hrSyncStatus;

  const backupSizeGb = numberValue(backup.sizeGb);
  const backupLatest = stringValue(backup.latest);
  const backupStatusText = flags.backup === null ? fieldText("flags.backup", "") :
    flags.backup ? `${fieldText("backup.latest", formatBackupStatus(true, backupLatest, backupSizeGb))}${isCheckFieldUnknown(result, "backup.sizeGb") ? ` / 용량 ${fieldText("backup.sizeGb", "")}` : ""}` : "이상";

  const agentWin = stringValue(versions.agentWin);
  const agentMac = stringValue(versions.agentMac);
  const agentParts: string[] = [];
  if (agentWin) {
    agentParts.push(`Windows : ${agentWin}`);
  }
  if (agentMac) {
    agentParts.push(`Mac : ${agentMac}`);
  }
  const agentVersionText = agentParts.join("  ") || "미수집";

  const memTotalGb = numberValue(system.memTotalGb);
  const memUsagePercent = numberValue(system.memUsagePercent);
  const osInfo =
    stringValue(system.osInfo) ||
    pickString(raw, ["checkOsVersion", "osVersion", "osInfo", "os_info", "system.osInfo"]) ||
    pickString(rawLogData, ["checkOsVersion", "osVersion", "osInfo"]);

  const engineerName = stringValue(manual.engineerName) || "점검자";
  const engineerSignatureName = stringValue(manual.engineerSignatureName) || engineerName;
  if (isRetiredEngineerName(engineerName) || isRetiredEngineerName(engineerSignatureName)) {
    throw new ApiError(400, "ENGINEER_INACTIVE", "선택한 점검자는 현재 목록에서 제외되었습니다. 점검자를 다시 선택하세요.");
  }

  return {
    companyName: stringValue(manual.companyName) || stringValue(result.companyName) || "고객사",
    serial: stringValue(manual.serial) || stringValue(result.serial) || "-",
    productName: stringValue(manual.productName) || stringValue(result.softwareName) || "오피스키퍼",
    engineerName,
    engineerSignatureName,
    opinion: stringValue(manual.opinion),
    checkDate: fieldText("system.checkTime", formatDate(Number.isNaN(checkTime.getTime()) ? new Date() : checkTime)),
    lastReboot: fieldText("system.lastReboot", lastReboot ? formatDateText(lastReboot) : "-"),
    dockerVersion: fieldText("versions.docker", stringValue(versions.docker)),
    licenseSummary: `${fieldText("license.total", String(license.total))} (${fieldText("license.used", String(license.used))}/${fieldText("license.unverified", String(license.unverified))})`,
    agentVersionText,
    agentWin: fieldText("versions.agentWin", agentWin),
    agentMac: fieldText("versions.agentMac", agentMac),
    osInfo: fieldText("system.osInfo", osInfo),
    serverModel: stringValue(manual.serverModel) || inferDocumentServerModel(system.serverModel || result.hardwareType) || "-",
    cpuUsage: fieldText("system.cpuUsagePercent", formatCpuUsage(numberValue(system.cpuUsagePercent))),
    memTotalText: fieldText("system.memTotalGb", `${memTotalGb} GB`),
    memActualText: fieldText("system.memUsagePercent", `${memUsagePercent}%`),
    loadSummary: (["load1", "load5", "load15"] as const)
      .map((key) => fieldText(`system.${key}`, formatLoadAverage(numberValue(system[key]))))
      .join(" / "),
    diskRoot: formatDisk(isRecord(disks.root) ? disks.root : {}, "root", fieldText),
    diskHome: formatDisk(isRecord(disks.home) ? disks.home : {}, "home", fieldText),
    diskStorage: formatDisk(isRecord(disks.storage) ? disks.storage : {}, "storage", fieldText),
    monthlyReportStatus: flags.monthlyReport === null ? fieldText("monthlyReport", "") : detailStatus(flags.monthlyReport, monthlyReportText),
    backupStatusText,
    hrSyncEnabled,
    hrSyncStatus,
    hrSyncDb,
    hrSyncCombined,
    securityStatus: dashStatus(flags.iptables),
    statuses: [
      ["Mysqld 서비스 구동 확인", statusText(flags.mysqld), ""],
      ["Httpd 서비스 구동 확인", statusText(flags.httpd), ""],
      ["Iptables 서비스 구동 확인", statusText(flags.iptables), ""],
      ["Agent 통신 확인", statusText(flags.agent), ""],
      ["웹 접속 확인", statusText(flags.web), ""],
      ["메일 서버 확인", statusText(flags.mail), ""],
      ["NTP 동기화 확인", statusText(flags.ntp), ""],
      ["백업 생성 확인", statusText(flags.backup), backupStatusText],
    ],
    flags,
    raw,
    quality,
    manualFlagKeys,
  };
}

async function buildDocx(
  context: ReportContext,
  supabase: import("@supabase/supabase-js").SupabaseClient,
): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), "src", "templates", "check-report", "template.docx");
  if (!existsSync(templatePath)) {
    throw new ApiError(
      500,
      "CHECK_REPORT_TEMPLATE_MISSING",
      "점검 확인서 템플릿(template.docx)을 찾을 수 없습니다.",
    );
  }

  const signatureBuffer = await loadEngineerSignatureBuffer(supabase, context.engineerSignatureName);

  try {
    const zip = new PizZip(readFileSync(templatePath));
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(buildTemplateData(context, signatureBuffer !== null));
    const rendered = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
    const withMarks = applyResultCheckMarks(rendered, context);
    return signatureBuffer ? applyEngineerSignature(withMarks, signatureBuffer) : withMarks;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "check_report_template_render_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new ApiError(
      500,
      "CHECK_REPORT_TEMPLATE_RENDER_FAILED",
      "점검 확인서 DOCX 렌더링에 실패했습니다. 템플릿 또는 입력값을 확인하세요.",
    );
  }
}

function buildTemplateData(context: ReportContext, includeSignature: boolean) {
  const flagText = (key: keyof ReportFlags) => {
    const value = context.flags[key];
    const issueKey = `flags.${key}` as CheckFieldKey;
    if (value === null) return context.quality.invalidFields.includes(issueKey) ? "확인불가 (수집값 오류)" : "미수집 (원본 상태값 없음)";
    return `${dashStatus(value)}${context.manualFlagKeys.includes(key) ? " (수동 확인)" : ""}`;
  };
  return {
    company_name: context.companyName,
    serial: context.serial,
    product_name: context.productName,
    request_date: context.checkDate,
    contact: "-",
    vendor_name: "㈜ 지란지교소프트",
    check_dept: "비즈그룹 솔루션운영팀",
    engineer_name: context.engineerName,
    e_name: context.engineerName,
    check_date: context.checkDate,
    docker_version: context.dockerVersion,
    license_summary: context.licenseSummary,
    last_reboot: context.lastReboot,
    mysqld_status: flagText("mysqld"),
    httpd_status: flagText("httpd"),
    security_status: flagText("iptables"),
    agent_status: flagText("agent"),
    mail_status: "점검 X",
    web_status: flagText("web"),
    monthly_report_status: context.monthlyReportStatus,
    backup_status: `${context.backupStatusText}${context.manualFlagKeys.includes("backup") ? " (수동 확인)" : ""}`,
    ntp_sync_status: flagText("ntp"),
    hr_sync_status: context.hrSyncStatus,
    hr_sync_db: context.hrSyncDb,
    status: context.hrSyncCombined,
    db: context.hrSyncDb,
    agent_version: context.agentVersionText,
    Window: context.agentWin,
    Mac: context.agentMac,
    os_info: context.osInfo,
    server_model: context.serverModel,
    cpu_usage: context.cpuUsage,
    total: context.memTotalText,
    actual: context.memActualText,
    disk_root: context.diskRoot,
    disk_home: context.diskHome,
    disk_storage: context.diskStorage,
    memory_summary: `${context.memTotalText} / ${context.memActualText}`,
    load_summary: context.loadSummary,
    disk_summary: "",
    opinion: context.opinion,
    sign_customer_img: "",
    sign_engineer_img: "",
    sign: includeSignature ? ENGINEER_SIGNATURE_MARKER : "",
  };
}

const ENGINEER_SIGNATURE_MARKER = "__ENGINEER_SIGNATURE_8B7F2A__";
const ENGINEER_SIGNATURE_REL_ID = "rIdEngineerSignature";
const ENGINEER_SIGNATURE_FILE = "engineer_signature.png";
// 8mm × 3.05mm (420:160 비율). 1mm = 36000 EMU
const ENGINEER_SIGNATURE_WIDTH_EMU = 432000;
const ENGINEER_SIGNATURE_HEIGHT_EMU = 164571;

function applyEngineerSignature(buffer: Buffer, signature: Buffer): Buffer {
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "engineer_signature_zip_open_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return buffer;
  }

  const documentFile = zip.file("word/document.xml");
  const relsFile = zip.file("word/_rels/document.xml.rels");
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!documentFile || !relsFile || !contentTypesFile) {
    return buffer;
  }
  const documentXml = documentFile.asText();
  if (!documentXml.includes(ENGINEER_SIGNATURE_MARKER)) {
    return buffer;
  }

  // 1. embed image binary
  zip.file(`word/media/${ENGINEER_SIGNATURE_FILE}`, signature);

  // 2. add relationship (idempotent)
  const relsXml = relsFile.asText();
  if (!relsXml.includes(`Id="${ENGINEER_SIGNATURE_REL_ID}"`)) {
    const newRel = `<Relationship Id="${ENGINEER_SIGNATURE_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${ENGINEER_SIGNATURE_FILE}"/>`;
    const updatedRelsXml = relsXml.replace(/<\/Relationships>\s*$/, `${newRel}</Relationships>`);
    zip.file("word/_rels/document.xml.rels", updatedRelsXml);
  }

  // 3. ensure PNG content type registered
  const contentTypesXml = contentTypesFile.asText();
  if (!/Default\s+Extension="png"/i.test(contentTypesXml)) {
    const updatedContentTypes = contentTypesXml.replace(
      /<\/Types>\s*$/,
      `<Default Extension="png" ContentType="image/png"/></Types>`,
    );
    zip.file("[Content_Types].xml", updatedContentTypes);
  }

  // 4. replace marker text element with drawing
  const drawing = buildEngineerSignatureDrawing();
  const markerRegex = new RegExp(
    `<w:t(?:\\s[^>]*)?>(?:[^<]*${ENGINEER_SIGNATURE_MARKER}[^<]*)<\\/w:t>`,
    "g",
  );
  const updatedDocumentXml = documentXml.replace(markerRegex, drawing);
  zip.file("word/document.xml", updatedDocumentXml);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

function buildEngineerSignatureDrawing(): string {
  const aNs = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const picNs = "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const wpNs = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const rNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return [
    `<w:r><w:t xml:space="preserve">   </w:t></w:r>`,
    `<w:drawing>`,
    `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${wpNs}">`,
    `<wp:extent cx="${ENGINEER_SIGNATURE_WIDTH_EMU}" cy="${ENGINEER_SIGNATURE_HEIGHT_EMU}"/>`,
    `<wp:docPr id="100" name="EngineerSignature"/>`,
    `<wp:cNvGraphicFramePr/>`,
    `<a:graphic xmlns:a="${aNs}">`,
    `<a:graphicData uri="${picNs}">`,
    `<pic:pic xmlns:pic="${picNs}">`,
    `<pic:nvPicPr><pic:cNvPr id="100" name="EngineerSignature"/><pic:cNvPicPr/></pic:nvPicPr>`,
    `<pic:blipFill>`,
    `<a:blip r:embed="${ENGINEER_SIGNATURE_REL_ID}" xmlns:r="${rNs}"/>`,
    `<a:stretch><a:fillRect/></a:stretch>`,
    `</pic:blipFill>`,
    `<pic:spPr>`,
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${ENGINEER_SIGNATURE_WIDTH_EMU}" cy="${ENGINEER_SIGNATURE_HEIGHT_EMU}"/></a:xfrm>`,
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
    `</pic:spPr>`,
    `</pic:pic>`,
    `</a:graphicData>`,
    `</a:graphic>`,
    `</wp:inline>`,
    `</w:drawing>`,
  ].join("");
}

function applyResultCheckMarks(buffer: Buffer, context: ReportContext): Buffer {
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "check_report_post_render_zip_open_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return buffer;
  }

  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return buffer;
  }

  const original = docFile.asText();
  const next = rewriteResultCheckTable(original, buildResultCheckMap(context));
  if (!next || next === original) {
    return buffer;
  }

  zip.file("word/document.xml", next);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

function buildResultCheckMap(context: ReportContext): Record<string, boolean | null> {
  const flags = context.flags;
  const known = (...keys: CheckFieldKey[]) => keys.every(key => !isCheckFieldUnknown(context, key)) ? true : null;
  return {
    "서버 종료 log 확인": known("system.lastReboot"),
    "서버 종료 Log 확인": known("system.lastReboot"),
    "Mysqld 서비스 구동 확인": flags.mysqld,
    "MySQL 서비스 구동 확인": flags.mysqld,
    "Httpd 서비스 구동 확인": flags.httpd,
    "Iptables 서비스 구동 확인": flags.iptables,
    "Agent 통신확인(정책번호 변경)": flags.agent,
    "에이전트 통신 확인": flags.agent,
    "웹 접속 확인(웹로그인)": flags.web,
    "월간 보고서 생성여부 확인": flags.monthlyReport,
    "월간 보고서 생성 여부 확인": flags.monthlyReport,
    "월 DB 덤프파일 생성여부 확인": flags.backup,
    "월간 DB 덤프파일 생성 여부 확인": flags.backup,
    "시간 동기화 확인(Ntp, Chrony)": flags.ntp,
    "에이전트 버전": known("versions.agentWin") || known("versions.agentMac"),
    "서버 OS 정보": known("system.osInfo"),
    "CPU 점유율 확인": known("system.cpuUsagePercent"),
    "Memory 사용량 확인": known("system.memTotalGb", "system.memUsagePercent"),
    "Load average(시스템부하율) 확인": known("system.load1", "system.load5", "system.load15"),
    "시스템부하율 확인": known("system.load1", "system.load5", "system.load15"),
    "디스크 사용량 확인": known("disks.root.size", "disks.root.usedPercent", "disks.home.size", "disks.home.usedPercent", "disks.storage.size", "disks.storage.usedPercent"),
    "인사연동 사용 여부": known("hrSync"),
  };
}

const TABLE_REGEX = /<w:tbl(?:\s|>)[\s\S]*?<\/w:tbl>/g;
const ROW_REGEX = /<w:tr(?:\s|>)[\s\S]*?<\/w:tr>/g;
const CELL_REGEX = /<w:tc(?:\s|>)[\s\S]*?<\/w:tc>/g;
const TEXT_REGEX = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function rewriteResultCheckTable(xml: string, checkMap: Record<string, boolean | null>): string | null {
  let processed = false;
  const next = xml.replace(TABLE_REGEX, (table) => {
    if (processed) {
      return table;
    }
    const updated = applyChecksToTable(table, checkMap);
    if (updated === table) {
      return table;
    }
    processed = true;
    return updated;
  });
  return processed ? next : null;
}

function applyChecksToTable(table: string, checkMap: Record<string, boolean | null>): string {
  const rowMatches: Array<{ match: string; index: number; length: number }> = [];
  for (const match of table.matchAll(ROW_REGEX)) {
    if (typeof match.index !== "number") continue;
    rowMatches.push({ match: match[0], index: match.index, length: match[0].length });
  }
  if (rowMatches.length === 0) {
    return table;
  }

  let headerIdx = -1;
  let okCol = -1;
  let badCol = -1;
  for (let i = 0; i < rowMatches.length; i += 1) {
    const cellTexts = extractRowCellTexts(rowMatches[i].match);
    const okIdx = cellTexts.findIndex((text) => normalizeWhitespace(text) === "정상");
    const badIdx = cellTexts.findIndex((text) => /비정상/.test(normalizeWhitespace(text)));
    if (okIdx >= 0 && badIdx >= 0) {
      headerIdx = i;
      okCol = okIdx;
      badCol = badIdx;
      break;
    }
  }
  if (headerIdx < 0 || okCol < 0 || badCol < 0) {
    return table;
  }

  const replacements = new Map<string, string>();
  const labelKeys = Object.keys(checkMap);
  for (let i = headerIdx + 1; i < rowMatches.length; i += 1) {
    const rowStr = rowMatches[i].match;
    const cellMatches: Array<{ match: string; index: number; length: number }> = [];
    for (const cell of rowStr.matchAll(CELL_REGEX)) {
      if (typeof cell.index !== "number") continue;
      cellMatches.push({ match: cell[0], index: cell.index, length: cell[0].length });
    }
    if (cellMatches.length <= Math.max(okCol, badCol)) {
      continue;
    }

    const cellTexts = cellMatches.map((cell) => normalizeWhitespace(extractTextFromCell(cell.match)));
    let label: string | null = null;
    for (const text of cellTexts) {
      for (const key of labelKeys) {
        if (text.includes(key)) {
          label = key;
          break;
        }
      }
      if (label) break;
    }
    if (!label) {
      continue;
    }

    const ok = checkMap[label];
    // Clear both template cells first: an unknown result has neither check mark.
    let newRow = rowStr;
    for (const index of [okCol, badCol].sort((a, b) => b - a)) {
      const cell = cellMatches[index];
      const mark = ok === null ? "" : (index === (ok ? okCol : badCol) ? "✓" : "");
      newRow = newRow.slice(0, cell.index) + setCellMark(cell.match, mark) + newRow.slice(cell.index + cell.length);
    }
    replacements.set(rowStr, newRow);
  }

  if (replacements.size === 0) {
    return table;
  }

  let next = table;
  for (const [oldRow, newRow] of replacements) {
    next = next.replace(oldRow, newRow);
  }
  return next;
}

function extractRowCellTexts(rowXml: string): string[] {
  const texts: string[] = [];
  for (const cell of rowXml.matchAll(CELL_REGEX)) {
    texts.push(extractTextFromCell(cell[0]));
  }
  return texts;
}

function extractTextFromCell(cellXml: string): string {
  let combined = "";
  for (const t of cellXml.matchAll(TEXT_REGEX)) {
    combined += unescapeXml(t[1] ?? "");
  }
  return combined;
}

function setCellMark(cellXml: string, mark: string): string {
  const openTag = cellXml.match(/^<w:tc(?:\s[^>]*)?>/)?.[0] ?? "<w:tc>";
  const tcPr = cellXml.match(/<w:tcPr(?:\s|>)[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
  return `${openTag}${tcPr}${buildCheckMarkParagraph(mark)}</w:tc>`;
}

function buildCheckMarkParagraph(mark: string): string {
  return [
    `<w:p>`,
    `<w:pPr><w:jc w:val="center"/></w:pPr>`,
    `<w:r>`,
    `<w:rPr>`,
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕" w:cs="Arial"/>`,
    `<w:b/>`,
    `<w:color w:val="000000"/>`,
    `<w:sz w:val="20"/>`,
    `</w:rPr>`,
    `<w:t>${escapeXml(mark)}</w:t>`,
    `</w:r>`,
    `</w:p>`,
  ].join("");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}


function formatDate(date: Date) {
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

function formatDateText(value: string) {
  const text = value.trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }
  return text;
}

function formatDisk(disk: Record<string, unknown>, key: "root" | "home" | "storage", fieldText: (key: CheckFieldKey, known: string) => string) {
  return `${fieldText(`disks.${key}.used`, stringValue(disk.used))} / ${fieldText(`disks.${key}.usedPercent`, `${numberValue(disk.usedPercent)}%`)} (Total : ${fieldText(`disks.${key}.size`, stringValue(disk.size))})`;
}

function formatCpuUsage(value: number) {
  return value.toFixed(1);
}

function formatLoadAverage(value: number) {
  return value.toFixed(2);
}

function statusText(value: unknown) {
  if (value === null) return "미수집 / 확인불가";
  return booleanValue(value) ? "정상" : "이상";
}

function dashStatus(value: unknown) {
  if (value === null) return "미수집 / 확인불가";
  return booleanValue(value) ? "-" : "이상";
}

function detailStatus(value: unknown, detail: string) {
  const trimmed = detail.trim();
  if (booleanValue(value)) {
    return trimmed || "-";
  }
  return trimmed ? `이상(${trimmed})` : "이상";
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return /^(true|y|yes|ok|1|active|running|success|normal|정상|o)(?:\b|\(|$)/i.test(value.trim());
  }
  return false;
}

function extractOrgSyncDb(value: string) {
  const match = value
    .trim()
    .match(/^(?:true|y|yes|ok|1|active|running|success|normal|정상|o)\s*\(([^)]+)\)/i);
  return match?.[1]?.trim() ?? "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(stringValue(value)) || 0;
}

function formatMonthlyReportMonth(value: string) {
  const text = value.trim();
  const monthMatch = text.match(/\b(\d{4})-(\d{2})\b/);
  if (monthMatch) {
    return `${monthMatch[1]}-${monthMatch[2]}`;
  }
  if (/^\d{6}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4)}`;
  }
  return text;
}

function parseLogData(value: unknown) {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatBackupStatus(ok: boolean, latest: string, sizeGb: number) {
  if (!ok) {
    return "이상";
  }
  if (!latest) {
    return "-";
  }
  const size = Number.isFinite(sizeGb) ? sizeGb : 0;
  if (size <= 0) {
    return latest;
  }
  const sizeText = size < 1 ? `${Math.round(size * 1024)}MB` : `${size.toFixed(2)}GB`;
  return `${latest}, ${sizeText}`;
}

function pickBoolean(data: Record<string, unknown>, paths: string[]): boolean {
  for (const candidate of paths) {
    let cursor: unknown = data;
    for (const part of candidate.split(".")) {
      if (!isRecord(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[part];
    }
    if (cursor !== undefined && cursor !== null) {
      return booleanValue(cursor);
    }
  }
  return false;
}

function pickString(data: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    let cursor: unknown = data;
    for (const part of path.split(".")) {
      if (!isRecord(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[part];
    }
    if (typeof cursor === "string" && cursor.trim()) {
      return cursor.trim();
    }
    if (typeof cursor === "number" || typeof cursor === "boolean") {
      return String(cursor);
    }
  }
  return "";
}
