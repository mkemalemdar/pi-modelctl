// Test-only pi extension: load it AFTER pi-modelctl to record what actually goes to the server.
// Appends JSON lines to $MODELCTL_PROBE_LOG. Not shipped (outside src/).

import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function probe(pi: ExtensionAPI): void {
  const file = process.env.MODELCTL_PROBE_LOG;
  if (!file) return;
  const log = (rec: Record<string, unknown>) => appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...rec })}\n`);

  pi.on("before_provider_request", (event, ctx) => {
    const p = event.payload as Record<string, unknown>;
    const msgs = Array.isArray(p.messages) ? p.messages : [];
    log({
      t: "request",
      model: p.model,
      max_tokens: p.max_tokens,
      max_completion_tokens: p.max_completion_tokens,
      thinking_budget_tokens: p.thinking_budget_tokens,
      reasoning_budget_tokens: p.reasoning_budget_tokens,
      thinking_token_budget: p.thinking_token_budget,
      reasoning_effort: p.reasoning_effort,
      kwargs: p.chat_template_kwargs,
      messages: msgs.length,
      payloadChars: JSON.stringify(p).length,
      usage: ctx.getContextUsage(),
      level: pi.getThinkingLevel(),
    });
    return undefined;
  });

  pi.on("message_end", (event) => {
    const m = event.message as { role?: string; usage?: unknown; stopReason?: unknown; content?: unknown; errorMessage?: unknown };
    if (m.role !== "assistant") return undefined;
    const content = Array.isArray(m.content) ? (m.content as { type: string; text?: string; thinking?: string; name?: string }[]) : [];
    log({
      t: "assistant",
      usage: m.usage,
      stop: m.stopReason,
      error: m.errorMessage,
      thinkingChars: content.filter((c) => c.type === "thinking").reduce((n, c) => n + (c.thinking?.length ?? 0), 0),
      textChars: content.filter((c) => c.type === "text").reduce((n, c) => n + (c.text?.length ?? 0), 0),
      text: content.filter((c) => c.type === "text").map((c) => c.text).join("").slice(0, 160),
      toolCalls: content.filter((c) => c.type === "toolCall").length,
    });
    return undefined;
  });

  pi.on("session_before_compact", (event) => {
    log({ t: "before_compact", reason: event.reason, tokensBefore: event.preparation.tokensBefore });
    return undefined;
  });
  pi.on("session_compact", (event) => {
    log({ t: "compacted", reason: event.reason, fromExtension: event.fromExtension, tokensBefore: event.compactionEntry.tokensBefore });
  });
  pi.on("session_compact_failed", (event) => {
    log({ t: "compact_failed", reason: event.reason, error: event.errorMessage, aborted: event.aborted });
  });
  pi.on("tool_result", (event) => {
    log({ t: "tool_result", tool: event.toolName, isError: event.isError, text: JSON.stringify(event.content).slice(0, 200) });
    return undefined;
  });
  pi.on("model_select", (event) => {
    log({ t: "model_select", model: `${event.model.provider}/${event.model.id}`, source: event.source });
  });
  pi.on("thinking_level_select", (event) => {
    log({ t: "level", level: event.level, previous: event.previousLevel });
  });
}
