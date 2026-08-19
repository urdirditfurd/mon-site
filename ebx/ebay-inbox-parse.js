/**
 * Parsers XML Trading API — GetMemberMessages + GetMyMessages.
 * Module pur (pas d’I/O) pour tests et sync inbox.
 */

function xmlUnescape(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi");
  return String(xml || "").match(re) || [];
}

function xmlField(block, tag) {
  const m = String(block || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim();
  return xmlUnescape(raw);
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMemberMessagesXml(xml) {
  const blocks = extractXmlBlocks(xml, "MemberMessageExchange");
  return blocks
    .map((b) => {
      const msg = extractXmlBlocks(b, "Question")[0] || b;
      return {
        messageId: xmlField(msg, "MessageID") || xmlField(b, "MessageID"),
        itemId: xmlField(b, "ItemID") || xmlField(msg, "ItemID"),
        itemTitle: xmlField(b, "Title") || xmlField(msg, "ItemTitle"),
        sender: xmlField(msg, "SenderID") || xmlField(b, "SenderID"),
        recipient: xmlField(msg, "RecipientID") || "",
        subject: xmlField(msg, "Subject") || xmlField(b, "Subject"),
        body: stripHtml(xmlField(msg, "Body") || xmlField(b, "Body")),
        creationDate: xmlField(msg, "CreationDate") || xmlField(b, "CreationDate"),
        messageStatus: xmlField(b, "MessageStatus") || xmlField(msg, "MessageStatus"),
        answered: /Answered/i.test(xmlField(b, "MessageStatus") || ""),
        source: "member",
      };
    })
    .filter((m) => m.messageId || m.body);
}

function folderIdOf(block) {
  const nested = extractXmlBlocks(block, "Folder")[0] || "";
  return xmlField(nested, "FolderID") || xmlField(block, "FolderID") || "0";
}

function parseMyMessagesXml(xml) {
  const blocks = extractXmlBlocks(xml, "Message");
  return blocks
    .map((b) => {
      const folderId = folderIdOf(b);
      const body = stripHtml(xmlField(b, "Text") || xmlField(b, "Content") || xmlField(b, "Body"));
      return {
        messageId: xmlField(b, "MessageID"),
        itemId: xmlField(b, "ItemID"),
        itemTitle: xmlField(b, "ItemTitle") || xmlField(b, "Title"),
        sender: xmlField(b, "Sender") || xmlField(b, "SenderID") || "eBay",
        recipient: xmlField(b, "RecipientUserID") || xmlField(b, "RecipientID") || "",
        subject: xmlField(b, "Subject"),
        body,
        creationDate: xmlField(b, "ReceiveDate") || xmlField(b, "CreationDate") || xmlField(b, "ExpirationDate"),
        messageStatus: /true/i.test(xmlField(b, "Read")) ? "Read" : "Unread",
        answered: false,
        folderId,
        highPriority: /true/i.test(xmlField(b, "HighPriority")),
        source: "mymessages",
      };
    })
    .filter((m) => {
      if (String(m.folderId) === "1") return false; // Sent
      return Boolean(m.messageId || m.subject || m.body);
    });
}

function mergeInboxMessages(memberMessages = [], myMessages = []) {
  const byId = new Map();
  for (const m of memberMessages || []) {
    const id = String(m.messageId || "").trim();
    if (!id && !m.body) continue;
    const key = id ? `member:${id}` : `member:${m.itemId}-${m.sender}-${m.creationDate}`;
    byId.set(key, { ...m, messageId: key.slice(0, 80), source: "member" });
  }
  for (const m of myMessages || []) {
    const id = String(m.messageId || "").trim();
    if (!id && !m.body && !m.subject) continue;
    const key = id ? `mm:${id}` : `mm:${m.sender}-${m.creationDate}-${m.subject}`.slice(0, 80);
    if (!byId.has(key)) byId.set(key, { ...m, messageId: key.slice(0, 80), source: "mymessages" });
  }
  return [...byId.values()];
}

module.exports = {
  xmlUnescape,
  xmlField,
  extractXmlBlocks,
  stripHtml,
  parseMemberMessagesXml,
  parseMyMessagesXml,
  mergeInboxMessages,
};
