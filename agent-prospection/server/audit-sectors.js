#!/usr/bin/env node
/**
 * Audit multi-secteurs : vérifie qu'avec les garde-fous SIREN/teasers
 * on trouve encore des contacts cohérents (téléphone et/ou e-mail valides).
 */
const fs = require("fs");
const path = require("path");
const {
  listSectors,
  runProspection,
  phoneFitsCompany,
  isSirenTeaserPhone,
  isRealCompanyWebsite
} = (() => {
  const agent = require("./prospection-agent");
  return {
    listSectors: agent.listSectors,
    runProspection: agent.runProspection,
    phoneFitsCompany: agent.phoneFitsCompany,
    isSirenTeaserPhone: agent.isSirenTeaserPhone,
    isRealCompanyWebsite: (url) => {
      // mirror: no directory hosts as company site — use published website emptiness if filtered
      return Boolean(url && /^https?:\/\//i.test(url) && !/pappers\.fr|pagesjaunes\.fr|societe\.com|annuaire-entreprises/i.test(url));
    }
  };
})();

const OUT = process.env.AUDIT_OUT || "/opt/cursor/artifacts/prospection_sector_audit.json";
const DAYS = process.env.AUDIT_DAYS || "all";
const LIMIT = Number(process.env.AUDIT_LIMIT || 10);
const ZONE = process.env.AUDIT_ZONE || process.env.AUDIT_DEPARTMENT || "idf";
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 2);

function validateContact(company) {
  const issues = [];
  if (!company.hasContact) return { ok: false, issues: ["no_contact"] };
  if (!company.email && !company.phone) issues.push("empty_channels");
  if (company.phone) {
    if (!phoneFitsCompany(company.phone, company)) issues.push("phone_rejected_by_fits");
    if (isSirenTeaserPhone(company.phone, company)) issues.push("phone_siren_teaser");
  }
  if (company.website && !isRealCompanyWebsite(company.website)) {
    issues.push("directory_website");
  }
  if (!company.siren) issues.push("missing_siren");
  return { ok: issues.length === 0, issues };
}

async function auditSector(sectorId) {
  const started = Date.now();
  const events = [];
  try {
    const result = await runProspection(
      {
        sector: sectorId,
        days: DAYS,
        limit: LIMIT,
        zone: ZONE,
        department: ZONE,
        contactsOnly: true,
        senderName: "Audit Cabinets",
        senderEmail: "audit@example.com"
      },
      (event) => {
        if (event.type === "status" || event.type === "progress") {
          events.push({ t: Date.now() - started, ...event });
        }
      }
    );
    const companies = (result.companies || []).filter((c) => c.hasContact);
    const checks = companies.map((c) => {
      const v = validateContact(c);
      return {
        name: c.name,
        siren: c.siren,
        email: c.email || "",
        phone: c.phone || "",
        source: c.contactSource || "",
        website: c.website || "",
        preferredChannel: c.preferredChannel || (c.phone ? "sms" : c.email ? "mail" : ""),
        ok: v.ok,
        issues: v.issues
      };
    });
    const bad = checks.filter((c) => !c.ok);
    return {
      sector: sectorId,
      ok: bad.length === 0,
      scanned: result.summary?.scanned || 0,
      withContact: companies.length,
      withPhone: companies.filter((c) => c.phone).length,
      withEmail: companies.filter((c) => c.email).length,
      badCount: bad.length,
      durationMs: Date.now() - started,
      contacts: checks,
      sampleStatus: events.filter((e) => e.type === "status").slice(-3).map((e) => e.message)
    };
  } catch (error) {
    return {
      sector: sectorId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      withContact: 0,
      contacts: []
    };
  }
}

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return out;
}

async function main() {
  const sectors = listSectors().map((s) => s.id);
  console.log(`Audit ${sectors.length} secteur(s) — days=${DAYS} limit=${LIMIT} zone="${ZONE}"`);
  const rows = await mapPool(sectors, CONCURRENCY, async (id) => {
    process.stderr.write(`→ ${id}…\n`);
    const row = await auditSector(id);
    process.stderr.write(
      `✓ ${id}: contacts=${row.withContact} phone=${row.withPhone || 0} mail=${row.withEmail || 0} bad=${row.badCount || 0} (${Math.round((row.durationMs || 0) / 1000)}s)\n`
    );
    return row;
  });

  const withHits = rows.filter((r) => (r.withContact || 0) > 0);
  const withBad = rows.filter((r) => (r.badCount || 0) > 0 || r.error);
  const report = {
    generatedAt: new Date().toISOString(),
    params: { DAYS, LIMIT, ZONE, CONCURRENCY },
    summary: {
      sectors: rows.length,
      sectorsWithContact: withHits.length,
      sectorsWithBadContact: withBad.length,
      totalContacts: rows.reduce((n, r) => n + (r.withContact || 0), 0),
      totalBad: rows.reduce((n, r) => n + (r.badCount || 0), 0)
    },
    sectors: rows
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const md = [
    "# Audit prospection multi-secteurs",
    "",
    `- Généré : ${report.generatedAt}`,
    `- Paramètres : days=${DAYS}, limit ${LIMIT}, zone ${ZONE}`,
    `- Secteurs avec ≥1 contact : **${report.summary.sectorsWithContact}/${report.summary.sectors}**`,
    `- Contacts invalides détectés : **${report.summary.totalBad}**`,
    "",
    "| Secteur | Contacts | Tél | Mail | Invalides | Durée |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map((r) => `| ${r.sector} | ${r.withContact || 0} | ${r.withPhone || 0} | ${r.withEmail || 0} | ${r.badCount || 0}${r.error ? " ERR" : ""} | ${Math.round((r.durationMs || 0) / 1000)}s |`),
    "",
    "## Détail contacts",
    ...rows.flatMap((r) => {
      if (!r.contacts?.length) return [`### ${r.sector}`, "_aucun_", ""];
      return [
        `### ${r.sector}`,
        ...r.contacts.map((c) => `- ${c.ok ? "OK" : "BAD"} **${c.name}** (${c.siren}) · ${c.phone || "—"} · ${c.email || "—"} · ${c.source}${c.issues?.length ? ` · issues: ${c.issues.join(",")}` : ""}`),
        ""
      ];
    })
  ].join("\n");
  const mdOut = OUT.replace(/\.json$/, ".md");
  fs.writeFileSync(mdOut, md);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(`Wrote ${mdOut}`);
  if (report.summary.sectorsWithBadContact > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
