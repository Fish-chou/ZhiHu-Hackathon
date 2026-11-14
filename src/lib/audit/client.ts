import { findDemoCache, toCachedResponse } from "./demo-cache";
import type { AuditErrorResponse, AuditResponse, ContentType } from "./types";

export type ClientOutcome =
  | { kind: "result"; data: AuditResponse }
  | { kind: "error"; code: string; message: string };

const MODES = new Set(["live", "rules_only", "no_evidence", "cached_demo"]);

/** Structural check before anything is rendered: every cited id must have a verified evidence card. */
export function isValidAuditResponse(x: unknown): x is AuditResponse {
  const r = x as AuditResponse;
  if (!r || r.ok !== true || !MODES.has(r.mode) || !r.result || !Array.isArray(r.result.findings) || !Array.isArray(r.evidence)) {
    return false;
  }
  if (!r.evidence.every((c) => c && c.status === "verified" && typeof c.id === "string" && typeof c.sourceUrl === "string")) {
    return false;
  }
  const ids = new Set(r.evidence.map((c) => c.id));
  return r.result.findings.every(
    (f) => typeof f.location === "string" && Array.isArray(f.evidence_ids) && f.evidence_ids.length > 0 && f.evidence_ids.every((id) => ids.has(id)),
  );
}

function isErrorBody(x: unknown): x is AuditErrorResponse {
  const e = x as AuditErrorResponse;
  return !!e && e.ok === false && typeof e.error?.message === "string";
}

function cacheFallback(contentType: ContentType, text: string, demoId: string | undefined, reason: string): ClientOutcome | null {
  const entry = findDemoCache(contentType, text, demoId);
  return entry ? { kind: "result", data: toCachedResponse(entry, reason) } : null;
}

export async function requestAudit(input: { contentType: ContentType; text: string; demoId?: string }): Promise<ClientOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  try {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "Vietnam", ...input }),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && isValidAuditResponse(body)) return { kind: "result", data: body };
    if (isErrorBody(body)) {
      if (res.status >= 500) {
        const fb = cacheFallback(input.contentType, input.text, input.demoId, `${body.error.message}。`);
        if (fb) return fb;
      }
      return { kind: "error", code: body.error.code, message: body.error.message };
    }
    return (
      cacheFallback(input.contentType, input.text, input.demoId, "服务返回的结果格式异常。") ?? {
        kind: "error",
        code: "invalid_result",
        message: "服务返回的结果格式异常，没有展示。请重试。",
      }
    );
  } catch {
    const timedOut = controller.signal.aborted;
    return (
      cacheFallback(input.contentType, input.text, input.demoId, timedOut ? "请求超时。" : "网络连接失败。") ?? {
        kind: "error",
        code: timedOut ? "timeout" : "network",
        message: timedOut ? "审查请求超时，请稍后重试。" : "网络连接失败，请检查网络后重试。",
      }
    );
  } finally {
    clearTimeout(timer);
  }
}
