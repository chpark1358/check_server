import type { NextRequest } from "next/server";
import {
  apiOk,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { getZendeskSettings } from "@/lib/server/settings";
import { buildTicketDraft, buildZendeskTicketPayload } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const body = await readJsonObject(request);
    const settings = await getZendeskSettings(auth.supabase);
    const draft = buildTicketDraft(body, settings);
    const payload = buildZendeskTicketPayload(draft);

    await writeAuditLog(auth.supabase, auth.user, "zendesk.ticket.preview", "zendesk_ticket", null, {
      requestId,
      subject: draft.subject,
      organizationId: draft.organizationId,
      autoSolve: draft.autoSolve,
      uploadCount: draft.uploadTokens.length,
    });

    return apiOk(requestId, {
      preview: {
        dryRunOnly: true,
        ticket: payload,
      },
    });
  });
}
