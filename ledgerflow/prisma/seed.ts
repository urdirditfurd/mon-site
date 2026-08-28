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

  // Factures PAYÉES (TVA collectée sur encaissements — dashboard)
  const paidInvoices = [
    {
      id: "inv_seed_paid_june",
      partyId: "party_dupont",
      number: "F-2026-0095",
      issueDate: new Date("2026-06-05"),
      dueDate: new Date("2026-06-20"),
      paidAt: new Date("2026-06-18"),
      subtotalHt: 1000,
      vatAmount: 200,
      totalTtc: 1200,
      line: "Atelier stratégique",
    },
    {
      id: "inv_seed_paid_july_a",
      partyId: "party_technova",
      number: "F-2026-0098",
      issueDate: new Date("2026-07-02"),
      dueDate: new Date("2026-07-16"),
      paidAt: new Date("2026-07-14"),
      subtotalHt: 3500,
      vatAmount: 700,
      totalTtc: 4200,
      line: "Sprint produit",
    },
    {
      id: "inv_seed_paid_july_b",
      partyId: "party_lefevre",
      number: "F-2026-0099",
      issueDate: new Date("2026-07-08"),
      dueDate: new Date("2026-07-22"),
      paidAt: new Date("2026-07-20"),
      subtotalHt: 800,
      vatAmount: 160,
      totalTtc: 960,
      line: "Conseil fiscal",
    },
  ];

  for (const inv of paidInvoices) {
    await prisma.invoice.upsert({
      where: { id: inv.id },
      update: {
        status: "PAID",
        partyId: inv.partyId,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        subtotalHt: inv.subtotalHt,
        vatAmount: inv.vatAmount,
        totalTtc: inv.totalTtc,
      },
      create: {
        id: inv.id,
        companyId: company.id,
        partyId: inv.partyId,
        type: "INVOICE",
        status: "PAID",
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        subtotalHt: inv.subtotalHt,
        vatAmount: inv.vatAmount,
        totalTtc: inv.totalTtc,
        vatRate: 20,
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

  await prisma.company.update({
    where: { id: company.id },
    data: { vatRegime: "ENCASHMENT" },
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
    update: { nextNumber: 104 },
    create: {
      companyId: company.id,
      type: "INVOICE",
      year: 2026,
      prefix: "F",
      nextNumber: 104,
    },
  });

  // Notes de frais seedées après le PCG (voir plus bas)

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

  // Plan Comptable Général (extrait essentiel)
  const pcgAccounts: Array<{
    id: string;
    number: string;
    label: string;
    type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  }> = [
    {
      id: "pcg_512000",
      number: "512000",
      label: "Banque",
      type: "ASSET",
    },
    {
      id: "pcg_606000",
      number: "606000",
      label: "Achats non stockés de matières et fournitures",
      type: "EXPENSE",
    },
    {
      id: "pcg_625000",
      number: "625000",
      label: "Déplacements, missions et réceptions",
      type: "EXPENSE",
    },
    {
      id: "pcg_626000",
      number: "626000",
      label: "Frais postaux et de télécommunications",
      type: "EXPENSE",
    },
    {
      id: "pcg_627000",
      number: "627000",
      label: "Services bancaires et assimilés",
      type: "EXPENSE",
    },
    {
      id: "pcg_641000",
      number: "641000",
      label: "Rémunération du personnel",
      type: "EXPENSE",
    },
    {
      id: "pcg_671000",
      number: "671000",
      label: "Charges exceptionnelles",
      type: "EXPENSE",
    },
    {
      id: "pcg_706000",
      number: "706000",
      label: "Prestations de services",
      type: "REVENUE",
    },
  ];

  for (const account of pcgAccounts) {
    await prisma.account.upsert({
      where: {
        companyId_number: { companyId: company.id, number: account.number },
      },
      update: { label: account.label, type: account.type, isActive: true },
      create: {
        id: account.id,
        companyId: company.id,
        number: account.number,
        label: account.label,
        type: account.type,
      },
    });
  }

  // Règle apprise d'exemple (Spotify déjà mémorisé)
  const spotifyAccount = await prisma.account.findFirst({
    where: { companyId: company.id, number: "626000" },
  });
  if (spotifyAccount) {
    await prisma.categorizationRule.upsert({
      where: {
        companyId_keyword: { companyId: company.id, keyword: "SPOTIFY" },
      },
      update: { accountId: spotifyAccount.id, isActive: true },
      create: {
        companyId: company.id,
        keyword: "SPOTIFY",
        accountId: spotifyAccount.id,
        priority: 10,
        hitCount: 1,
      },
    });
  }

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
      label: "VIR URSSAF",
      amount: -1500,
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
      id: "btx_seed_spotify",
      bookingDate: new Date("2026-07-21"),
      label: "PRELEVEMENT SPOTIFY",
      amount: -12.99,
      externalId: "seed-spotify",
    },
    {
      id: "btx_seed_aws",
      bookingDate: new Date("2026-07-20"),
      label: "CARTE CB AMAZON AWS",
      amount: -45.5,
      externalId: "seed-aws",
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
        categorizedAccountId: null,
        categorizedAt: null,
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

  // Historique cashflow (mois précédents) + catégorisation avec TVA estimée
  const historyTxns = [
    {
      id: "btx_hist_may_in",
      bookingDate: new Date("2026-05-15"),
      label: "VIR CLIENT MAI",
      amount: 4800,
      externalId: "hist-may-in",
    },
    {
      id: "btx_hist_may_out",
      bookingDate: new Date("2026-05-20"),
      label: "CB FOURNITURES MAI",
      amount: -320,
      externalId: "hist-may-out",
    },
    {
      id: "btx_hist_june_in",
      bookingDate: new Date("2026-06-18"),
      label: "VIR DUPONT SARL F-2026-0095",
      amount: 1200,
      externalId: "hist-june-in",
    },
    {
      id: "btx_hist_june_out",
      bookingDate: new Date("2026-06-22"),
      label: "PRLV OVH CLOUD",
      amount: -72,
      externalId: "hist-june-out",
    },
  ];

  for (const txn of historyTxns) {
    await prisma.bankTransaction.upsert({
      where: { id: txn.id },
      update: {
        label: txn.label,
        amount: txn.amount,
        bookingDate: txn.bookingDate,
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

  const byNumber = async (number: string) =>
    prisma.account.findFirst({ where: { companyId: company.id, number } });

  const acc626 = await byNumber("626000");
  const acc641 = await byNumber("641000");
  const acc627 = await byNumber("627000");

  // AWS 45.50 TTC → TVA estimée 7.58 ; Spotify 12.99 → 2.17 ; URSSAF hors TVA
  const categorizations: Array<{
    id: string;
    accountId: string | undefined;
    vatAmount: number | null;
    estimated: boolean;
  }> = [
    {
      id: "btx_seed_aws",
      accountId: acc626?.id,
      vatAmount: 7.58,
      estimated: true,
    },
    {
      id: "btx_seed_spotify",
      accountId: acc626?.id,
      vatAmount: 2.17,
      estimated: true,
    },
    {
      id: "btx_seed_fees",
      accountId: acc627?.id,
      vatAmount: 0,
      estimated: false,
    },
    {
      id: "btx_seed_urssaf",
      accountId: acc641?.id,
      vatAmount: null,
      estimated: false,
    },
    {
      id: "btx_hist_june_out",
      accountId: acc626?.id,
      vatAmount: 12,
      estimated: true,
    },
  ];

  for (const item of categorizations) {
    if (!item.accountId) continue;
    await prisma.bankTransaction.update({
      where: { id: item.id },
      data: {
        categorizedAccountId: item.accountId,
        categorizedAt: new Date("2026-07-28"),
        suggestedAccountId: item.accountId,
        suggestionConfidence: 100,
        suggestionReason: "Seed dashboard",
        suggestionSource: "HEURISTIC",
        vatAmount: item.vatAmount,
        vatEstimated: item.estimated,
      },
    });
  }

  await prisma.bankAccount.update({
    where: { id: bankAccount.id },
    data: { balance: 42870.14 },
  });

  const acc625 = await prisma.account.findFirst({
    where: { companyId: company.id, number: "625000" },
  });

  const expenseSeeds = [
    {
      id: "exp_seed_bistro",
      merchantName: "Restaurant Le Bistro",
      status: "APPROVED" as const,
      category: "RESTAURANT" as const,
      expenseDate: new Date("2026-07-18"),
      amountTtc: 120,
      amountHt: 100,
      vatAmount: 20,
      vatEstimated: false,
      description: "Déjeuner client",
      note: "Seed dashboard TVA",
    },
    {
      id: "exp_seed_uber",
      merchantName: "Uber",
      status: "PENDING" as const,
      category: "TRANSPORT" as const,
      expenseDate: new Date("2026-07-22"),
      amountTtc: 15.5,
      amountHt: 12.92,
      vatAmount: 2.58,
      vatEstimated: true,
      description: "Trajet gare",
      note: null as string | null,
    },
    {
      id: "exp_seed_sncf",
      merchantName: "SNCF",
      status: "APPROVED" as const,
      category: "TRANSPORT" as const,
      expenseDate: new Date("2026-07-18"),
      amountTtc: 89,
      amountHt: 80.91,
      vatAmount: 8.09,
      vatEstimated: false,
      description: "Aller-retour Lille-Paris",
      note: null as string | null,
    },
  ];

  for (const exp of expenseSeeds) {
    await prisma.expense.upsert({
      where: { id: exp.id },
      update: {
        status: exp.status,
        merchantName: exp.merchantName,
        amountTtc: exp.amountTtc,
        amountHt: exp.amountHt,
        vatAmount: exp.vatAmount,
        vatEstimated: exp.vatEstimated,
        expenseDate: exp.expenseDate,
        accountId: acc625?.id,
        category: exp.category,
        note: exp.note,
      },
      create: {
        id: exp.id,
        companyId: company.id,
        employeeId: "emp_demo",
        status: exp.status,
        category: exp.category,
        merchantName: exp.merchantName,
        description: exp.description,
        expenseDate: exp.expenseDate,
        amountTtc: exp.amountTtc,
        amountHt: exp.amountHt,
        vatAmount: exp.vatAmount,
        vatEstimated: exp.vatEstimated,
        vatRate: 20,
        accountId: acc625?.id,
        note: exp.note,
        approvedAt: exp.status === "APPROVED" ? new Date("2026-07-19") : null,
      },
    });
  }

  console.log("Seed OK — company", company.name);
  console.log(
    `  ${openInvoices.length} factures ouvertes, ${paidInvoices.length} payées, ${txns.length}+ historique txns, ${pcgAccounts.length} comptes PCG, ${expenseSeeds.length} notes de frais`,
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
