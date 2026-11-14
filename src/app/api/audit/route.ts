import { after } from "next/server";
import { logAnalysisRun } from "@/lib/audit/audit-log";
import { handleAuditPost } from "@/lib/audit/handler";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { response, toLog } = await handleAuditPost(req);
  if (toLog) after(() => logAnalysisRun(toLog));
  return response;
}
