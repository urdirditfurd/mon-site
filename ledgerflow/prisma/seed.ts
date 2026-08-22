import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "co_atelier_nord" },
    update: {
      name: "Atelier Nord SAS",
      legalName: "Atelier Nord SAS",
      siret: "89245678100034",
      vatNumber: "FR42892456781",
      address: "12 rue de la Monnaie",
      city: "Lille",
      zipCode: "59000",
      email: "compta@atelier-nord.fr",
      vatExempt: false,
    },
    create: {
      id: "co_atelier_nord",
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

  const parties = [
    {
      id: "party_dupont",
      name: "Maison Dupont",
      email: "compta@maisondupont.fr",
      type: "CUSTOMER" as const,
      siret: "51234567800019",
      address: "8 avenue Foch",
      city: "Paris",
      zipCode: "75016",
    },
    {
      id: "party_lumiere",
      name: "Studio Lumière",
      email: "hello@studiolumiere.co",
      type: "CUSTOMER" as const,
      siret: "82345678900012",
      address: "3 rue Nationale",
      city: "Lille",
      zipCode: "59000",
    },
    {
      id: "party_technova",
      name: "TechNova SARL",
      email: "factures@technova.io",
      type: "CUSTOMER" as const,
      siret: "90123456700028",
      address: "42 boulevard Vauban",
      city: "Lyon",
      zipCode: "69006",
    },
    {
      id: "party_lefevre",
      name: "Cabinet Lefèvre",
      email: "contact@cabinet-lefevre.fr",
      type: "BOTH" as const,
      siret: "44556677800033",
      address: "15 place de la République",
      city: "Roubaix",
      zipCode: "59100",
    },
  ];

  for (const party of parties) {
    await prisma.party.upsert({
      where: { id: party.id },
      update: {
        name: party.name,
        email: party.email,
        type: party.type,
        siret: party.siret,
        address: party.address,
        city: party.city,
        zipCode: party.zipCode,
      },
      create: {
        ...party,
        companyId: company.id,
        country: "FR",
      },
    });
  }

  const existingCount = await prisma.invoice.count({
    where: { companyId: company.id },
  });

  if (existingCount === 0) {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: company.id,
        partyId: "party_dupont",
        type: "INVOICE",
        status: "SENT",
        number: "F-2026-0001",
        issueDate: new Date("2026-06-02"),
        dueDate: new Date("2026-07-02"),
        subtotalHt: 4200,
        vatAmount: 840,
        totalTtc: 5040,
        vatRate: 20,
        notes: "Prestation de design produit — juin 2026",
        lines: {
          create: [
            {
              description: "Design UX — forfait mensuel",
              quantity: 1,
              unitPriceHt: 3200,
              vatRate: 20,
              amountHt: 3200,
              sortOrder: 0,
            },
            {
              description: "Atelier découverte (journée)",
              quantity: 2,
              unitPriceHt: 500,
              vatRate: 20,
              amountHt: 1000,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    await prisma.invoiceSequence.upsert({
      where: {
        companyId_type_year_prefix: {
          companyId: company.id,
          type: "INVOICE",
          year: 2026,
          prefix: "F",
        },
      },
      update: { nextNumber: 2 },
      create: {
        companyId: company.id,
        type: "INVOICE",
        year: 2026,
        prefix: "F",
        nextNumber: 2,
      },
    });

    console.log("Seeded invoice", invoice.number);
  }

  console.log("Seed OK — company", company.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
