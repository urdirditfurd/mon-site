const fs = require("fs");
const path = require("path");
const {
  parseMemberMessagesXml,
  parseMyMessagesXml,
  mergeInboxMessages,
  stripHtml,
} = require("./ebay-inbox-parse");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

const memberXml = `<?xml version="1.0" encoding="utf-8"?>
<GetMemberMessagesResponse>
  <Ack>Success</Ack>
  <MemberMessageExchange>
    <Item>
      <ItemID>110011001100</ItemID>
      <Title>Coque iPhone 15</Title>
    </Item>
    <Question>
      <MessageID>ASK-1</MessageID>
      <SenderID>buyer123</SenderID>
      <Subject>Question sur la livraison</Subject>
      <Body><![CDATA[Bonjour, délai ?]]></Body>
      <CreationDate>2026-08-17T09:00:00.000Z</CreationDate>
    </Question>
    <MessageStatus>Unanswered</MessageStatus>
  </MemberMessageExchange>
</GetMemberMessagesResponse>`;

const member = parseMemberMessagesXml(memberXml);
check(member.length === 1, `GetMemberMessages parse count=${member.length}`);
check(member[0].sender === "buyer123", `sender=${member[0].sender}`);
check(member[0].subject.includes("livraison"), `subject=${member[0].subject}`);
check(member[0].body.includes("délai"), `body=${member[0].body}`);
check(member[0].itemId === "110011001100", `itemId=${member[0].itemId}`);

const myXml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesResponse>
  <Ack>Success</Ack>
  <Messages>
    <Message>
      <Sender>eBay</Sender>
      <RecipientUserID>vendeurfr</RecipientUserID>
      <Subject>Your item sold!</Subject>
      <MessageID>778899</MessageID>
      <ReceiveDate>2026-08-17T10:00:00.000Z</ReceiveDate>
      <ItemID>110011001100</ItemID>
      <Text><![CDATA[<p>Félicitations, votre objet a été vendu.</p>]]></Text>
      <Folder><FolderID>0</FolderID></Folder>
      <Read>false</Read>
      <HighPriority>true</HighPriority>
    </Message>
    <Message>
      <Sender>me</Sender>
      <MessageID>sent-copy</MessageID>
      <Subject>Réponse envoyée</Subject>
      <Folder><FolderID>1</FolderID></Folder>
    </Message>
  </Messages>
</GetMyMessagesResponse>`;

const mine = parseMyMessagesXml(myXml);
check(mine.length === 1, `GetMyMessages ignore Sent, count=${mine.length}`);
check(mine[0].sender === "eBay", `my sender=${mine[0].sender}`);
check(mine[0].subject === "Your item sold!", `my subject=${mine[0].subject}`);
check(mine[0].body.includes("vendu"), `my body stripped html=${mine[0].body}`);
check(!/<p>/.test(mine[0].body), "HTML retiré du corps My Messages");
check(mine[0].messageId === "778899", `raw MessageID not confused with MessageID tag (${mine[0].messageId})`);

const merged = mergeInboxMessages(member, mine);
check(merged.length === 2, `merge count=${merged.length}`);
check(merged.some((m) => String(m.messageId).startsWith("member:")), "prefix member:");
check(merged.some((m) => String(m.messageId).startsWith("mm:")), "prefix mm:");

check(stripHtml("<br>a<br/>b").includes("a"), "stripHtml br");

const serverSrc = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const tickStart = serverSrc.indexOf("async function runAutoPublishTick");
const tickEnd = serverSrc.indexOf("const insertCompetitor");
const tickFn = serverSrc.slice(tickStart, tickEnd);
check(tickStart > 0 && tickEnd > tickStart, "runAutoPublishTick localisé");
check(!/autoOrderMode/.test(tickFn), "runAutoPublishTick n'utilise pas autoOrderMode");
check(!/getSupplierConfig/.test(tickFn), "runAutoPublishTick n'appelle pas getSupplierConfig");
check(serverSrc.includes('reason: "not-armed"'), "Auto-Publish DFY skip si non armé");
check(serverSrc.includes("PRODUCT_NAME"), "cockpit branding BayPilot");
check(serverSrc.includes("paymentNeverAutonomous"), "API rappelle paiement manuel");
check(serverSrc.includes("startInboxSyncScheduler()"), "scheduler inbox démarré au boot");
check(serverSrc.includes("syncEbayInbox"), "sync utilise GetMemberMessages + GetMyMessages");
check(/Automatisation OFF/.test(fs.readFileSync(path.join(__dirname, "app.js"), "utf8")), "UI avertit si toggle OFF");
check(/Pilotage DFY/.test(fs.readFileSync(path.join(__dirname, "app.js"), "utf8")), "page Pilotage DFY");

const setupVps = fs.readFileSync(path.join(__dirname, "scripts", "setup-baypilot-vps.sh"), "utf8");
check(setupVps.includes("baypilot-ops"), "PM2 baypilot-ops");
check(setupVps.includes("N'arrête pas") || setupVps.includes("n'efface pas"), "script VPS ne touche pas ebx");
check(setupVps.includes('/var/www/ebx'), "garde-fou APP_DIR ebx");
check(!/pm2 delete ebx/.test(setupVps), "ne supprime jamais le process ebx");

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests inbox / Auto-Order vs Auto-Publish OK");
