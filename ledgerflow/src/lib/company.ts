import { prisma } from "@/lib/prisma";

/** Entreprise démo mono-tenant pour le MVP local. */
export const DEMO_COMPANY_ID = "co_atelier_nord";

export async function ensureDemoCompany() {
  const company = await prisma.company.upsert({
    where: { id: DEMO_COMPANY_ID },
    update: {},
    create: {
      id: DEMO_COMPANY_ID,
      name: "Atelier Nord SAS",
      legalName: "Atelier Nord SAS",
      siret: "89245678100034",
      siren: "892456781",
      vatNumber: "FR42892456781",
      address: "12 rue de la Monnaie",
      city: "Lille",
      zipCode: "59000",
      country: "FR",
      email: "compta@atelier-nord.fr",
      phone: "03 20 00 00 00",
      vatExempt: false,
    },
  });
  return company;
}

export async function getDemoCompany() {
  return (
    (await prisma.company.findUnique({ where: { id: DEMO_COMPANY_ID } })) ??
    (await ensureDemoCompany())
  );
}
