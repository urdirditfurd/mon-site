import { AppShell } from "@/components/layout/AppShell";
import { Dashboard } from "@/modules/dashboard/Dashboard";

export default function HomePage() {
  return (
    <AppShell
      title="Tableau de bord"
      subtitle="Vue consolidée · Atelier Nord SAS"
    >
      <Dashboard />
    </AppShell>
  );
}
