export function mapLarkCliEvent(raw) {
  const message = raw?.event?.message || raw?.message || raw || {};
  const sender = raw?.event?.sender || raw?.sender || {};
  const base = {
    messageId: raw?.message_id || message?.message_id || raw?.id || "",
    chatId: raw?.chat_id || message?.chat_id || "",
    senderId: raw?.sender_id || sender?.sender_id?.open_id || sender?.sender_id?.user_id || "",
    senderType: raw?.sender_type || sender?.sender_type || "",
    chatType: raw?.chat_type || message?.chat_type || "",
    eventId: raw?.event_id || raw?.header?.event_id || "",
    createTime: raw?.create_time || message?.create_time || ""
  };

  const eventType = raw?.type || raw?.event_type || raw?.header?.event_type;
  if (!raw || eventType !== "im.message.receive_v1") {
    return { type: "ignored", reason: "unsupported event type", ...base };
  }

  if (["app", "bot"].includes(String(base.senderType).toLowerCase())) {
    return { type: "ignored", reason: "bot message", ...base };
  }

  const messageType = raw?.message_type || message?.message_type;
  if (messageType !== "text") {
    return { type: "unsupported", reason: "暂时只支持文本消息。", ...base };
  }

  const text = extractText(raw?.content ?? message?.content);
  if (!text) {
    return { type: "unsupported", reason: "请发送一段文本。", ...base };
  }

  if (isServiceReply(text)) {
    return { type: "ignored", reason: "service reply", ...base };
  }

  if (text === "\u5e2e\u52a9" || text.toLowerCase() === "help") {
    return { type: "help", reason: "可用命令：tasks [关键词] [project:项目] [page:页码]、open <编号>、open、status、approve/reject <审批码>、exit。普通文本会发送到当前 Task。", ...base };
  }

  return {
    type: "text",
    text,
    ...base
  };
}

function extractText(content) {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.text === "string") return parsed.text.trim();
    } catch {
      // lark-cli flattened events may already expose plain text.
    }
    return trimmed;
  }

  if (typeof content?.text === "string") return content.text.trim();
  return "";
}

function isServiceReply(text) {
  return text === "\u5df2\u8bb0\u5f55"
    || text === "\u5df2\u8bb0\u5f55\u8fc7\u8be5\u7075\u611f\u3002"
    || text.startsWith("\u5df2\u8bb0\u5f55\n")
    || text.startsWith("\ud83e\udd16 Codex \u5df2\u6536\u5230\u4efb\u52a1")
    || text.startsWith("\ud83e\udd16 Codex \u6b63\u5728\u6267\u884c\u4efb\u52a1")
    || text.startsWith("\u2705 Codex \u5df2\u5b8c\u6210")
    || text.startsWith("\u26a0\ufe0f Codex ");
}
