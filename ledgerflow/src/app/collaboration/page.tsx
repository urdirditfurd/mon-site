import { MessageSquare, PenLine, Shield } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function CollaborationPage() {
  return (
    <AppShell
      title="Collaboration"
      subtitle="Espace client ↔ expert-comptable (phase 2)"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Shield,
            title: "Permissions",
            text: "Rôles Owner, Accountant, Manager, Employee, Viewer sur CompanyMembership.",
          },
          {
            icon: MessageSquare,
            title: "Commentaires",
            text: "EntryComment lié aux écritures pour le dialogue avec le cabinet.",
          },
          {
            icon: PenLine,
            title: "Signature électronique",
            text: "Hook prévu pour Yousign / DocuSign sur devis et documents légaux.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <div className="mb-2 w-fit rounded-lg bg-slate-100 p-2 text-[#0B1F33]">
                <item.icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.text}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                Schéma Prisma déjà en place — UI complète au sprint collaboration.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
