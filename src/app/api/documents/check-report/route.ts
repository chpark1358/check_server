import type { NextRequest } from "next/server";
import Docxtemplater from "docxtemplater";
import PDFDocument from "pdfkit";
import PizZip from "pizzip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { apiOk, isRecord, readJsonObject, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeneratedDocument = {
  type: "docx" | "pdf";
  fileName: string;
  contentType: string;
  base64: string;
  size: number;
};

type ReportContext = {
  companyName: string;
  serial: string;
  productName: string;
  engineerName: string;
  opinion: string;
  checkDate: string;
  lastReboot: string;
  dockerVersion: string;
  licenseSummary: string;
  agentVersion: string;
  osInfo: string;
  serverModel: string;
  cpuUsage: string;
  memorySummary: string;
  loadSummary: string;
  diskRoot: string;
  diskHome: string;
  diskStorage: string;
  monthlyReportStatus: string;
  hrSyncStatus: string;
  hrSyncDb: string;
  statuses: Array<[string, string, string]>;
  flags: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    enforceMemoryRateLimit(`document-check-report:${auth.user.id}`, 10, 60_000);

    const body = await readJsonObject(request);
    const context = buildReportContext(body);
    const output = isRecord(body.output) ? body.output : {};
    const includeDocx = output.docx !== false;
    const includePdf = output.pdf !== false;
    const documents: GeneratedDocument[] = [];

    if (includeDocx) {
      const docx = await buildDocx(context);
      documents.push(toDocument("docx", buildFileName(context.companyName, "docx"), docx));
    }

    if (includePdf) {
      const pdf = await buildPdf(context);
      documents.push(toDocument("pdf", buildFileName(context.companyName, "pdf"), pdf));
    }

    await writeAuditLog(auth.supabase, auth.user, "document.check_report.generate", "document", null, {
      requestId,
      companyName: context.companyName,
      serial: context.serial,
      types: documents.map((document) => document.type),
    });

    return apiOk(requestId, { documents });
  });
}

function buildReportContext(body: Record<string, unknown>): ReportContext {
  const result = isRecord(body.checkResult) ? body.checkResult : {};
  const manual = isRecord(body.manual) ? body.manual : {};
  const license = isRecord(result.license) ? result.license : {};
  const versions = isRecord(result.versions) ? result.versions : {};
  const system = isRecord(result.system) ? result.system : {};
  const disks = isRecord(result.disks) ? result.disks : {};
  const flags = isRecord(result.flags) ? result.flags : {};
  const backup = isRecord(result.backup) ? result.backup : {};
  const raw = isRecord(result.raw) ? result.raw : {};
  const checkTime = stringValue(system.checkTime) ? new Date(stringValue(system.checkTime)) : new Date();
  const lastReboot = stringValue(system.lastReboot);
  const hrSyncDb = pickString(raw, ["orgSyncDb", "orgSyncDbFormat", "sync.orgSyncDb", "sync.dbFormat"]) || "-";
  const hrSyncStatus = statusCode(flags.hrSyncEnabled);
  const monthlyReportLatest = pickString(raw, ["monthlyReportLatest", "monthly_report_latest", "report.monthlyReportLatest"]);

  return {
    companyName: stringValue(manual.companyName) || stringValue(result.companyName) || "고객사",
    serial: stringValue(manual.serial) || stringValue(result.serial) || "-",
    productName: stringValue(manual.productName) || stringValue(result.softwareName) || "오피스키퍼",
    engineerName: stringValue(manual.engineerName) || "점검자",
    opinion: stringValue(manual.opinion),
    checkDate: formatDate(Number.isNaN(checkTime.getTime()) ? new Date() : checkTime),
    lastReboot: lastReboot ? formatDateText(lastReboot) : "-",
    dockerVersion: stringValue(versions.docker) || "-",
    licenseSummary: `${numberValue(license.total)} (${numberValue(license.used)}/${numberValue(license.unverified)})`,
    agentVersion: [stringValue(versions.agentWin), stringValue(versions.agentMac)]
      .filter(Boolean)
      .join(" / ") || "-",
    osInfo: stringValue(system.osInfo) || "-",
    serverModel: stringValue(system.serverModel) || "-",
    cpuUsage: `${numberValue(system.cpuUsagePercent).toFixed(1)}%`,
    memorySummary: `${numberValue(system.memUsagePercent)}% / ${numberValue(system.memTotalGb)}GB`,
    loadSummary: [system.load1, system.load5, system.load15]
      .map((value) => numberValue(value).toFixed(2))
      .join(" / "),
    diskRoot: formatDisk(isRecord(disks.root) ? disks.root : {}),
    diskHome: formatDisk(isRecord(disks.home) ? disks.home : {}),
    diskStorage: formatDisk(isRecord(disks.storage) ? disks.storage : {}),
    monthlyReportStatus: detailStatus(flags.monthlyReport, monthlyReportLatest),
    hrSyncStatus,
    hrSyncDb,
    statuses: [
      ["Mysqld 서비스 구동 확인", statusText(flags.mysqld), ""],
      ["Httpd 서비스 구동 확인", statusText(flags.httpd), ""],
      ["Iptables 서비스 구동 확인", statusText(flags.iptables), ""],
      ["Agent 통신 확인", statusText(flags.agent), ""],
      ["웹 접속 확인", statusText(flags.web), ""],
      ["메일 서버 확인", statusText(flags.mail), ""],
      ["NTP 동기화 확인", statusText(flags.ntp), ""],
      ["백업 생성 확인", statusText(flags.backup), stringValue(backup.latest)],
    ],
    flags,
    raw,
  };
}

async function buildDocx(context: ReportContext) {
  const template = renderTemplateDocx(context);
  if (template) {
    return template;
  }

  const tableRows = [
    row("고객사", context.companyName, "시리얼", context.serial),
    row("제품명", context.productName, "점검일", context.checkDate),
    row("점검자", context.engineerName, "Docker", context.dockerVersion),
    row("라이선스", context.licenseSummary, "Agent", context.agentVersion),
    row("OS", context.osInfo, "서버 모델", context.serverModel),
    row("CPU", context.cpuUsage, "Memory", context.memorySummary),
    row("/", context.diskRoot, "/home", context.diskHome),
    row("/storage", context.diskStorage, "Load", context.loadSummary),
  ];

  const checkRows = [
    headerRow(["점검 항목", "결과", "비고"]),
    ...context.statuses.map(([label, status, remark]) => row(label, status, "비고", remark || "-")),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
            children: [new TextRun({ text: "오피스키퍼 정기점검 확인서", bold: true, size: 32 })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
          new Paragraph({ text: "", spacing: { after: 180 } }),
          new Paragraph({ children: [new TextRun({ text: "점검 결과", bold: true, size: 24 })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: checkRows,
          }),
          new Paragraph({ text: "", spacing: { after: 180 } }),
          new Paragraph({ children: [new TextRun({ text: "점검 의견", bold: true, size: 24 })] }),
          new Paragraph({ text: context.opinion || "-", spacing: { after: 360 } }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `점검자: ${context.engineerName}`, bold: true })],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function renderTemplateDocx(context: ReportContext): Buffer | null {
  const templatePath = path.join(process.cwd(), "src", "templates", "check-report", "template.docx");
  if (!existsSync(templatePath)) {
    return null;
  }

  try {
    const zip = new PizZip(readFileSync(templatePath));
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(buildTemplateData(context));
    return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch (error) {
    console.error("check-report template render failed", error);
    return null;
  }
}

function buildTemplateData(context: ReportContext) {
  const agentParts = context.agentVersion.split("/").map((part) => part.trim()).filter(Boolean);
  const winAgent = agentParts[0] ?? "";
  const macAgent = agentParts[1] ?? "";

  return {
    company_name: context.companyName,
    serial: context.serial,
    product_name: context.productName,
    request_date: context.checkDate,
    contact: "-",
    vendor_name: "지란지교소프트",
    check_dept: "비즈그룹 솔루션팀",
    engineer_name: context.engineerName,
    e_name: context.engineerName,
    check_date: context.checkDate,
    docker_version: context.dockerVersion,
    license_summary: context.licenseSummary,
    last_reboot: context.lastReboot,
    mysqld_status: dashStatus(context.flags.mysqld),
    httpd_status: dashStatus(context.flags.httpd),
    security_status: detailStatus(context.flags.iptables, pickString(context.raw, ["isIptablesActive", "network.iptablesState"])),
    agent_status: dashStatus(context.flags.agent),
    mail_status: "점검 X",
    web_status: dashStatus(context.flags.web),
    monthly_report_status: context.monthlyReportStatus,
    backup_status: context.statuses.find(([label]) => label.includes("백업"))?.[2] || dashStatus(context.flags.backup),
    ntp_sync_status: dashStatus(context.flags.ntp),
    hr_sync_status: context.hrSyncStatus,
    hr_sync_db: context.hrSyncDb,
    status: context.hrSyncDb && context.hrSyncDb !== "-" ? `${context.hrSyncStatus}(${context.hrSyncDb})` : context.hrSyncStatus,
    db: context.hrSyncDb,
    agent_version: context.agentVersion,
    Window: winAgent,
    Mac: macAgent,
    os_info: context.osInfo === "-" ? "" : context.osInfo,
    server_model: context.serverModel,
    cpu_usage: context.cpuUsage,
    total: `${numberValueFromMemory(context.memorySummary)} GB`,
    actual: context.memorySummary.split("/", 1)[0]?.trim() || "-",
    disk_root: context.diskRoot,
    disk_home: context.diskHome,
    disk_storage: context.diskStorage,
    memory_summary: context.memorySummary,
    load_summary: context.loadSummary,
    disk_summary: "",
    opinion: context.opinion,
    sign_customer_img: "",
    sign_engineer_img: "",
    sign: "",
  };
}

async function buildPdf(context: ReportContext) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fontPath = resolveKoreanFontPath();
    if (fontPath) {
      doc.registerFont("NotoSansKR", fontPath);
      doc.font("NotoSansKR");
    }

    doc.fontSize(20).text("오피스키퍼 정기점검 확인서", { align: "center" });
    doc.moveDown(1.2);
    writePdfKV(doc, "고객사", context.companyName, "시리얼", context.serial);
    writePdfKV(doc, "제품명", context.productName, "점검일", context.checkDate);
    writePdfKV(doc, "점검자", context.engineerName, "Docker", context.dockerVersion);
    writePdfKV(doc, "라이선스", context.licenseSummary, "Agent", context.agentVersion);
    writePdfKV(doc, "OS", context.osInfo, "서버 모델", context.serverModel);
    writePdfKV(doc, "CPU", context.cpuUsage, "Memory", context.memorySummary);
    writePdfKV(doc, "/", context.diskRoot, "/home", context.diskHome);
    writePdfKV(doc, "/storage", context.diskStorage, "Load", context.loadSummary);
    doc.moveDown(1);
    doc.fontSize(14).text("점검 결과");
    doc.moveDown(0.4);
    for (const [label, status, remark] of context.statuses) {
      doc.fontSize(10).text(`${label}: ${status}${remark ? ` (${remark})` : ""}`);
    }
    doc.moveDown(1);
    doc.fontSize(14).text("점검 의견");
    doc.fontSize(10).text(context.opinion || "-");
    doc.moveDown(2);
    doc.fontSize(11).text(`점검자: ${context.engineerName}`, { align: "right" });
    doc.end();
  });
}

function row(leftLabel: string, leftValue: string, rightLabel: string, rightValue: string) {
  return new TableRow({
    children: [
      cell(leftLabel, true),
      cell(leftValue),
      cell(rightLabel, true),
      cell(rightValue),
    ],
  });
}

function headerRow(labels: string[]) {
  return new TableRow({ children: labels.map((label) => cell(label, true)) });
}

function cell(text: string, bold = false) {
  return new TableCell({
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "D8DEE9" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "D8DEE9" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "D8DEE9" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "D8DEE9" },
    },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
  });
}

function writePdfKV(doc: PDFKit.PDFDocument, leftLabel: string, leftValue: string, rightLabel: string, rightValue: string) {
  const y = doc.y;
  doc.fontSize(9).text(leftLabel, 48, y, { width: 70, continued: false });
  doc.fontSize(10).text(leftValue, 118, y, { width: 160 });
  doc.fontSize(9).text(rightLabel, 300, y, { width: 70 });
  doc.fontSize(10).text(rightValue, 370, y, { width: 170 });
  doc.moveDown(0.7);
}

function toDocument(type: "docx" | "pdf", fileName: string, buffer: Buffer): GeneratedDocument {
  return {
    type,
    fileName,
    contentType:
      type === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    base64: buffer.toString("base64"),
    size: buffer.byteLength,
  };
}

function buildFileName(companyName: string, extension: "docx" | "pdf") {
  const safeCompany = companyName.replace(/[\\/:*?"<>|]/g, "").trim() || "고객사";
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `정기점검확인서_${safeCompany}_${yy}${mm}${dd}.${extension}`;
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

function formatDisk(disk: Record<string, unknown>) {
  return `${stringValue(disk.used) || "-"} / ${numberValue(disk.usedPercent)}% (Total : ${stringValue(disk.size) || "-"})`;
}

function statusText(value: unknown) {
  return booleanValue(value) ? "정상" : "이상";
}

function dashStatus(value: unknown) {
  return booleanValue(value) ? "-" : "이상";
}

function detailStatus(value: unknown, detail: string) {
  const trimmed = detail.trim();
  if (booleanValue(value)) {
    return trimmed || "-";
  }
  return trimmed ? `이상(${trimmed})` : "이상";
}

function statusCode(value: unknown) {
  return booleanValue(value) ? "O" : "X";
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return /^(true|y|yes|ok|1|active|running|success|normal|정상|o)$/i.test(value.trim());
  }
  return false;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(stringValue(value)) || 0;
}

function numberValueFromMemory(value: string) {
  const totalMatch = value.match(/\/\s*([\d.]+)/);
  if (totalMatch) {
    return Number(totalMatch[1]) || 0;
  }
  return 0;
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

function resolveKoreanFontPath() {
  const candidates = [
    path.join(process.cwd(), "node_modules", "@fontsource", "noto-sans-kr", "files", "noto-sans-kr-korean-400-normal.woff"),
    path.join(process.cwd(), "node_modules", "@fontsource", "noto-sans-kr", "files", "noto-sans-kr-latin-400-normal.woff"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
