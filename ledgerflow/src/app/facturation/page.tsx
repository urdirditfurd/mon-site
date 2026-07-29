import { AppShell } from "@/components/layout/AppShell";
import { InvoiceList } from "@/modules/invoicing/InvoiceList";

export default function FacturationPage() {
  return (
    <AppShell
      title="Facturation intelligente"
      subtitle="Devis → Facture → Relance automatique"
    >
      <InvoiceList />
    </AppShell>
  );
}
