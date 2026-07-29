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
      name: "DUPONT SARL",
      email: "compta@dupont-sarl.fr",
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
      id: "party_urssaf",
      name: "URSSAF",
      email: null as string | null,
      type: "SUPPLIER" as const,
      siret: "18003503100017",
      address: "Urssaf Nord",
      city: "Lille",
      zipCode: "59000",
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
        id: party.id,
        name: party.name,
        email: party.email,
        type: party.type,
        siret: party.siret,
        address: party.address,
        city: party.city,
        zipCode: party.zipCode,
        companyId: company.id,
        country: "FR",
      },
    });
  }

  // Factures ouvertes pour le lettrage
  const openInvoices = [
    {
      id: "inv_seed_dupont_open",
      partyId: "party_dupont",
      number: "F-2026-0101",
      status: "SENT" as const,
      issueDate: new Date("2026-07-10"),
      dueDate: new Date("2026-07-25"),
      subtotalHt: 2500,
      vatAmount: 500,
      totalTtc: 3000,
      notes: "Accompagnement produit — juillet",
      line: "Forfait conseil",
    },
    {
      id: "inv_seed_lumiere_open",
      partyId: "party_lumiere",
      number: "F-2026-0102",
      status: "OVERDUE" as const,
      issueDate: new Date("2026-06-20"),
      dueDate: new Date("2026-07-05"),
      subtotalHt: 1800,
      vatAmount: 360,
      totalTtc: 2160,
      notes: "Retouche identité visuelle",
      line: "Design graphique",
    },
    {
      id: "inv_seed_technova_open",
      partyId: "party_technova",
      number: "F-2026-0103",
      status: "SENT" as const,
      issueDate: new Date("2026-07-15"),
      dueDate: new Date("2026-07-30"),
      subtotalHt: 4200,
      vatAmount: 840,
      totalTtc: 5040,
      notes: "Sprint delivery",
      line: "Développement logiciel",
    },
  ];

  for (const inv of openInvoices) {
    await prisma.invoice.upsert({
      where: { id: inv.id },
      update: {
        status: inv.status,
        partyId: inv.partyId,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        subtotalHt: inv.subtotalHt,
        vatAmount: inv.vatAmount,
        totalTtc: inv.totalTtc,
        notes: inv.notes,
      },
      create: {
        id: inv.id,
        companyId: company.id,
        partyId: inv.partyId,
        type: "INVOICE",
        status: inv.status,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        subtotalHt: inv.subtotalHt,
        vatAmount: inv.vatAmount,
        totalTtc: inv.totalTtc,
        vatRate: 20,
        notes: inv.notes,
        lines: {
          create: [
            {
              description: inv.line,
              quantity: 1,
              unitPriceHt: inv.subtotalHt,
              vatRate: 20,
              amountHt: inv.subtotalHt,
              sortOrder: 0,
            },
          ],
        },
      },
    });
  }

  await prisma.invoiceSequence.upsert({
    where: {
      companyId_type_year_prefix: {
        companyId: company.id,
        type: "INVOICE",
        year: 2026,
        prefix: "F",
      },
    },
    update: { nextNumber: 104 },
    create: {
      companyId: company.id,
      type: "INVOICE",
      year: 2026,
      prefix: "F",
      nextNumber: 104,
    },
  });

  // Note de frais approuvée (débit à matcher)
  await prisma.expense.upsert({
    where: { id: "exp_seed_sncf" },
    update: {
      status: "APPROVED",
      merchantName: "SNCF",
      amountTtc: 89,
      expenseDate: new Date("2026-07-18"),
    },
    create: {
      id: "exp_seed_sncf",
      companyId: company.id,
      status: "APPROVED",
      category: "TRANSPORT",
      merchantName: "SNCF",
      description: "Aller-retour Lille-Paris",
      expenseDate: new Date("2026-07-18"),
      amountTtc: 89,
      amountHt: 80.91,
      vatAmount: 8.09,
      vatRate: 10,
      employeeId: "emp_camille",
    },
  });

  const bankAccount = await prisma.bankAccount.upsert({
    where: { id: "ba_bnp_courant" },
    update: {
      name: "Compte courant BNP",
      iban: "FR7610096000501234567890185",
      balance: 42870.14,
      lastSyncedAt: new Date("2026-07-28"),
    },
    create: {
      id: "ba_bnp_courant",
      companyId: company.id,
      name: "Compte courant BNP",
      iban: "FR7610096000501234567890185",
      currency: "EUR",
      provider: "CSV",
      balance: 42870.14,
      lastSyncedAt: new Date("2026-07-28"),
    },
  });

  const txns = [
    {
      id: "btx_seed_dupont",
      bookingDate: new Date("2026-07-24"),
      label: "VIR DUPONT SARL F-2026-0101",
      amount: 3000,
      externalId: "seed-dupont-3000",
    },
    {
      id: "btx_seed_lumiere",
      bookingDate: new Date("2026-07-08"),
      label: "VIREMENT STUDIO LUMIERE",
      amount: 2160,
      externalId: "seed-lumiere-2160",
    },
    {
      id: "btx_seed_urssaf",
      bookingDate: new Date("2026-07-22"),
      label: "PRLV URSSAF NORD JUILLET",
      amount: -1842.36,
      externalId: "seed-urssaf",
    },
    {
      id: "btx_seed_sncf",
      bookingDate: new Date("2026-07-19"),
      label: "CB SNCF CONNECT",
      amount: -89,
      externalId: "seed-sncf",
    },
    {
      id: "btx_seed_fees",
      bookingDate: new Date("2026-07-17"),
      label: "FRAIS TENUE COMPTE",
      amount: -12.5,
      externalId: "seed-fees",
    },
    {
      id: "btx_seed_unknown",
      bookingDate: new Date("2026-07-12"),
      label: "VIR REF 998877 INCONNU",
      amount: 450,
      externalId: "seed-unknown",
    },
  ];

  for (const txn of txns) {
    await prisma.bankTransaction.upsert({
      where: { id: txn.id },
      update: {
        label: txn.label,
        amount: txn.amount,
        bookingDate: txn.bookingDate,
        status: "UNMATCHED",
        isMatched: false,
        matchedInvoiceId: null,
        matchedExpenseId: null,
      },
      create: {
        id: txn.id,
        bankAccountId: bankAccount.id,
        externalId: txn.externalId,
        bookingDate: txn.bookingDate,
        label: txn.label,
        amount: txn.amount,
        currency: "EUR",
        status: "UNMATCHED",
        isMatched: false,
      },
    });
  }

  console.log("Seed OK — company", company.name);
  console.log(
    `  ${openInvoices.length} factures ouvertes, ${txns.length} transactions UNMATCHED`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
