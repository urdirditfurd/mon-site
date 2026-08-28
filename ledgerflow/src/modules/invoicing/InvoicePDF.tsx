import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface InvoicePdfParty {
  name: string;
  legalName?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  email?: string | null;
  vatExempt?: boolean;
}

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
  amountHt: number;
}

export interface InvoicePdfData {
  number: string;
  typeLabel: string;
  statusLabel: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  notes?: string | null;
  subtotalHt: number;
  vatAmount: number;
  totalTtc: number;
  issuer: InvoicePdfParty;
  customer: InvoicePdfParty;
  lines: InvoicePdfLine[];
}

const navy = "#0B1F33";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1e293b",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  brand: {
    fontSize: 18,
    color: navy,
    fontFamily: "Helvetica-Bold",
  },
  muted: {
    color: "#64748b",
    marginTop: 2,
  },
  docTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: navy,
    textAlign: "right",
  },
  docMeta: {
    marginTop: 4,
    textAlign: "right",
    color: "#334155",
  },
  parties: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 24,
  },
  partyBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
  },
  partyLabel: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  partyName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: navy,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: navy,
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  colDesc: { width: "42%" },
  colQty: { width: "12%", textAlign: "right" },
  colUnit: { width: "16%", textAlign: "right" },
  colVat: { width: "12%", textAlign: "right" },
  colHt: { width: "18%", textAlign: "right" },
  totals: {
    marginTop: 16,
    alignSelf: "flex-end",
    width: 220,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalStrong: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: navy,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  legal: {
    marginTop: 28,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    fontSize: 7.5,
    color: "#64748b",
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
  },
});

function money(n: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(n);
}

function addressBlock(p: InvoicePdfParty): string {
  return [p.address, [p.zipCode, p.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join("\n");
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  const allZeroVat =
    data.lines.length > 0 && data.lines.every((l) => l.vatRate === 0);
  const show293B = Boolean(data.issuer.vatExempt) && allZeroVat;

  return (
    <Document
      title={`${data.typeLabel} ${data.number}`}
      author={data.issuer.name}
      language="fr"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>{data.issuer.name}</Text>
            <Text style={styles.muted}>{data.issuer.legalName || ""}</Text>
            <Text style={styles.muted}>{addressBlock(data.issuer)}</Text>
            {data.issuer.siret ? (
              <Text style={styles.muted}>SIRET {data.issuer.siret}</Text>
            ) : null}
            {data.issuer.vatNumber ? (
              <Text style={styles.muted}>TVA {data.issuer.vatNumber}</Text>
            ) : null}
            {data.issuer.email ? (
              <Text style={styles.muted}>{data.issuer.email}</Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.docTitle}>{data.typeLabel.toUpperCase()}</Text>
            <Text style={styles.docMeta}>N° {data.number}</Text>
            <Text style={styles.docMeta}>Émise le {data.issueDate}</Text>
            <Text style={styles.docMeta}>Échéance {data.dueDate}</Text>
            <Text style={styles.docMeta}>Statut : {data.statusLabel}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyBox}>
            <Text style={styles.partyLabel}>Émetteur</Text>
            <Text style={styles.partyName}>{data.issuer.name}</Text>
            <Text>{addressBlock(data.issuer)}</Text>
            <Text>SIRET {data.issuer.siret || "—"}</Text>
          </View>
          <View style={styles.partyBox}>
            <Text style={styles.partyLabel}>Client</Text>
            <Text style={styles.partyName}>{data.customer.name}</Text>
            <Text>{addressBlock(data.customer)}</Text>
            <Text>SIRET {data.customer.siret || "—"}</Text>
            {data.customer.vatNumber ? (
              <Text>TVA {data.customer.vatNumber}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qté</Text>
          <Text style={styles.colUnit}>P.U. HT</Text>
          <Text style={styles.colVat}>TVA</Text>
          <Text style={styles.colHt}>Total HT</Text>
        </View>
        {data.lines.map((line, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDesc}>{line.description}</Text>
            <Text style={styles.colQty}>
              {line.quantity.toLocaleString("fr-FR")}
            </Text>
            <Text style={styles.colUnit}>
              {money(line.unitPriceHt, data.currency)}
            </Text>
            <Text style={styles.colVat}>
              {line.vatRate.toLocaleString("fr-FR")} %
            </Text>
            <Text style={styles.colHt}>
              {money(line.amountHt, data.currency)}
            </Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Total HT</Text>
            <Text>{money(data.subtotalHt, data.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Total TVA</Text>
            <Text>{money(data.vatAmount, data.currency)}</Text>
          </View>
          <View style={styles.totalStrong}>
            <Text style={{ fontFamily: "Helvetica-Bold", color: navy }}>
              Total TTC
            </Text>
            <Text style={{ fontFamily: "Helvetica-Bold", color: navy }}>
              {money(data.totalTtc, data.currency)}
            </Text>
          </View>
        </View>

        {data.notes ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>
              Notes
            </Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.legal}>
          {show293B ? (
            <Text>
              TVA non applicable, art. 293 B du CGI (franchise en base de TVA).
            </Text>
          ) : (
            <Text>
              Montant de la TVA calculé selon les taux en vigueur au jour
              d&apos;émission.
            </Text>
          )}
          <Text>
            En cas de retard de paiement, seront exigibles une pénalité égale à
            3 fois le taux d&apos;intérêt légal ainsi qu&apos;une indemnité
            forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et
            D441-5 du Code de commerce).
          </Text>
          <Text>
            Pas d&apos;escompte pour paiement anticipé. Conditions de paiement :
            virement, à réception / à l&apos;échéance indiquée.
          </Text>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.issuer.name} — ${data.typeLabel} ${data.number} — page ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
