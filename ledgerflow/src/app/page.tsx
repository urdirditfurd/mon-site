import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Dashboard } from "@/modules/dashboard/Dashboard";
import {
  getDashboardSnapshot,
  type DashboardPeriod,
} from "@/lib/financial-engine";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function parsePeriod(value: string | string[] | undefined): DashboardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "quarter" || raw === "year" || raw === "month") return raw;
  return "month";
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-5">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-8 w-32 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-5">
          <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
        </CardContent>
      </Card>
    </div>
  );
}

async function DashboardLoader({ period }: { period: DashboardPeriod }) {
  const data = await getDashboardSnapshot(period);
  return <Dashboard data={data} period={period} />;
}

export default function HomePage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const period = parsePeriod(searchParams?.period);

  return (
    <AppShell
      title="Tableau de bord"
      subtitle="Trésorerie · TVA · créances · résultat estimé"
    >
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardLoader period={period} />
      </Suspense>
    </AppShell>
  );
}
