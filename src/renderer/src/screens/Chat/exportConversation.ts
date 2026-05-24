import { marked } from "marked";
import type { ChatMessage } from "./types";

marked.setOptions({ breaks: true });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMessage(msg: ChatMessage): string {
  const roleLabel = msg.role === "user" ? "You" : "Hermes";
  const roleClass = msg.role === "user" ? "msg-user" : "msg-agent";

  let contentHtml = "";
  if (msg.role === "agent") {
    contentHtml = marked.parse(msg.content) as string;
  } else {
    // User messages: render attachments + plain text
    const attachmentHtml = (msg.attachments ?? [])
      .map((att) =>
        att.isImage
          ? `<img class="att-img" src="${att.dataUrl}" alt="${escapeHtml(att.name)}" />`
          : `<div class="att-file">📄 ${escapeHtml(att.name)}</div>`,
      )
      .join("");
    const textHtml = msg.content
      ? `<p>${escapeHtml(msg.content).replace(/\n/g, "<br>")}</p>`
      : "";
    contentHtml = attachmentHtml + textHtml;
  }

  return `
    <div class="message ${roleClass}">
      <div class="role-label">${roleLabel}</div>
      <div class="bubble">${contentHtml}</div>
    </div>`;
}

export function exportConversationAsHtml(
  messages: ChatMessage[],
  sessionId: string | null,
  sessionTitle: string | null,
): void {
  const title = sessionTitle || (sessionId ? `Session #${sessionId.slice(-6)}` : "Conversation");
  const exportDate = new Date().toLocaleString();
  const idLabel = sessionId ? ` <span class="session-id">#${sessionId.slice(-6)}</span>` : "";

  const messagesHtml = messages
    .filter((m) => m.content || (m.attachments && m.attachments.length > 0))
    .map(renderMessage)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }
    header {
      border-bottom: 1px solid #2d3748;
      padding-bottom: 20px;
      margin-bottom: 32px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      color: #f7fafc;
      margin: 0 0 6px;
    }
    .session-id {
      font-family: monospace;
      font-size: 13px;
      color: #718096;
      font-weight: 400;
    }
    .meta {
      font-size: 13px;
      color: #718096;
    }
    .message {
      margin-bottom: 28px;
    }
    .role-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .msg-user .role-label { color: #90cdf4; }
    .msg-agent .role-label { color: #9ae6b4; }
    .bubble {
      padding: 14px 18px;
      border-radius: 10px;
      font-size: 15px;
    }
    .msg-user .bubble {
      background: #1a2035;
      border: 1px solid #2d3a55;
      color: #e2e8f0;
    }
    .msg-agent .bubble {
      background: #141a24;
      border: 1px solid #2d3748;
      color: #e2e8f0;
    }
    .bubble p { margin: 0 0 12px; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble h1,.bubble h2,.bubble h3,.bubble h4 {
      color: #f7fafc;
      margin: 16px 0 8px;
      font-weight: 600;
    }
    .bubble h1 { font-size: 20px; }
    .bubble h2 { font-size: 17px; }
    .bubble h3 { font-size: 15px; }
    .bubble code {
      font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
      font-size: 13px;
      background: #1e2a3a;
      padding: 1px 5px;
      border-radius: 4px;
      color: #93c5fd;
    }
    .bubble pre {
      background: #1a2332;
      border: 1px solid #2d3748;
      border-radius: 8px;
      padding: 14px 16px;
      overflow-x: auto;
      margin: 12px 0;
    }
    .bubble pre code {
      background: none;
      padding: 0;
      color: #e2e8f0;
      font-size: 13px;
    }
    .bubble ul, .bubble ol {
      padding-left: 22px;
      margin: 8px 0;
    }
    .bubble li { margin-bottom: 4px; }
    .bubble blockquote {
      border-left: 3px solid #4a5568;
      margin: 12px 0;
      padding: 4px 16px;
      color: #a0aec0;
    }
    .bubble table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
      font-size: 14px;
    }
    .bubble th, .bubble td {
      border: 1px solid #2d3748;
      padding: 8px 12px;
      text-align: left;
    }
    .bubble th { background: #1a2332; color: #f7fafc; font-weight: 600; }
    .bubble a { color: #90cdf4; }
    .bubble hr { border: none; border-top: 1px solid #2d3748; margin: 16px 0; }
    .att-img {
      max-width: 100%;
      max-height: 300px;
      border-radius: 6px;
      margin-bottom: 8px;
      display: block;
    }
    .att-file {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1e2a3a;
      border: 1px solid #2d3748;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 13px;
      margin-bottom: 8px;
      color: #a0aec0;
    }
    footer {
      border-top: 1px solid #2d3748;
      padding-top: 16px;
      margin-top: 48px;
      font-size: 12px;
      color: #4a5568;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>${escapeHtml(title)}${idLabel}</h1>
      <div class="meta">Exported ${exportDate} · ${messages.length} messages</div>
    </header>

    <div class="messages">
      ${messagesHtml}
    </div>

    <footer>Exported from Hermes</footer>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${sessionId?.slice(-6) ?? "export"}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
