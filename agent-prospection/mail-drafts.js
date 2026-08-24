/**
 * Brouillons de prospection B2B (accroche selon activité + pied légal).
 * Utilisable côté navigateur et Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ProspectionMail = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const CLIENT_FOCUS_HOOKS = [
    {
      id: "btp",
      keys: ["batiment", "bâtiment", "btp", "macon", "maçon", "construction", "travaux publics", "genie civil", "plomberie", "electricite", "électricité", "couverture", "charpente"],
      hook: "Vous accompagnez des entreprises du bâtiment : des dossiers à fort volume de pièces, où la saisie pèse plus qu'ailleurs."
    },
    {
      id: "restauration",
      keys: ["restaurant", "restauration", "cafe", "café", "bar ", "hotellerie", "hôtellerie", "chr", "traiteur"],
      hook: "Vous accompagnez des restaurants et commerces de bouche : beaucoup de tickets, de TVA et de pièces à saisir chaque mois."
    },
    {
      id: "sante",
      keys: ["medical", "médical", "sante", "santé", "dentaire", "pharmacie", "infirmier", "kine", "kiné", "veterinaire", "vétérinaire"],
      hook: "Vous accompagnez des professions de santé : des dossiers réguliers, où la saisie absorbe trop de temps collaborateur."
    },
    {
      id: "commerce",
      keys: ["commerce", "boutique", "magasin", "detail", "détail", "e-commerce", "ecommerce"],
      hook: "Vous accompagnez des commerces : un flux de factures élevé, où la saisie pèse sur chaque clôture."
    },
    {
      id: "immobilier",
      keys: ["immobilier", "agence immobili", "gestion locative", "syndic", "marchand de biens"],
      hook: "Vous accompagnez des acteurs de l'immobilier : lots, honoraires et charges, avec une saisie souvent répétitive."
    },
    {
      id: "transport",
      keys: ["transport", "logistique", "demenag", "déménag", "vtc", "taxi"],
      hook: "Vous accompagnez des entreprises de transport : beaucoup de pièces, de TVA et de notes de frais à traiter."
    },
    {
      id: "artisanat",
      keys: ["artisan", "coiffure", "esthetique", "esthétique", "garage", "auto"],
      hook: "Vous accompagnez des artisans : des dossiers denses, où la saisie des factures prend trop de place."
    },
    {
      id: "services",
      keys: ["conseil", "consulting", "services aux entreprises", "holding"],
      hook: "Vous accompagnez des sociétés de services : des dossiers clients nombreux, où la saisie reste chronophage."
    }
  ];

  const DEFAULT_HOOK = "Vous gérez un volume important de dossiers clients : la saisie des factures pèse sur le temps de vos collaborateurs.";

  const STANDARD_BODY = `Je développe L'ARC avec un expert-comptable en exercice : à partir d'un FEC exporté de votre logiciel comptable, notre agent l'importe et mémorise tout l'historique comptable du cabinet. Ensuite, à chaque nouvelle facture que vous lui envoyez, il propose automatiquement une écriture comptable complète (compte, journal, tiers, taux et compte de TVA).

Le collaborateur peut échanger avec l'agent pour lui indiquer les ajustements souhaités : l'agent retient ces corrections et les applique dès la facture suivante, pour proposer une écriture toujours plus juste.

Nous avons créé un FEC fictif, celui d'une entreprise imaginaire avec plusieurs factures, pour vous faire une démonstration. Nous aimerions vous montrer la simplicité de fonctionnement de l'agent et l'aide qu'il peut apporter à votre cabinet : cela vous permettrait de vous concentrer sur des tâches à plus haute valeur ajoutée.

C'est gratuit et sans engagement.

Ça vaut 10 minutes au téléphone ?`;

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
  }

  function firstNameFromDirectors(directors) {
    const raw = Array.isArray(directors) ? directors[0] : "";
    const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0];
    if (/^(m\.|mme|mlle|monsieur|madame|maitre|maître)$/i.test(first) && parts[1]) {
      return parts[1];
    }
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  function greeting(company) {
    const first = firstNameFromDirectors(company && company.directors);
    return first ? `Bonjour ${first},` : "Bonjour,";
  }

  function companyBlob(company) {
    return normalizeKey([
      company && company.name,
      company && company.legalName,
      company && company.activity,
      company && company.nafLabel,
      company && company.website,
      company && company.address
    ].filter(Boolean).join(" "));
  }

  function inferClientFocus(company) {
    const blob = companyBlob(company);
    for (const row of CLIENT_FOCUS_HOOKS) {
      if (row.keys.some((key) => blob.includes(normalizeKey(key)))) {
        return { id: row.id, hook: row.hook };
      }
    }
    return { id: "general", hook: DEFAULT_HOOK };
  }

  function sourceLine(company) {
    const bits = ["base publique SIRENE (annuaire des entreprises)"];
    const site = company && company.website ? String(company.website).trim() : "";
    if (site && /^https?:\/\//i.test(site)) {
      bits.push(`adresse relevée sur votre site ${site}`);
    } else if (company && company.sireneUrl) {
      bits.push(`fiche consultée sur ${company.sireneUrl}`);
    }
    return bits.join(" ; ");
  }

  function legalFooter(sender, company) {
    const name = String((sender && sender.name) || "").trim();
    const role = String((sender && sender.role) || "").trim();
    const companyName = String((sender && sender.company) || "").trim();
    const email = String((sender && sender.email) || "").trim();
    const phone = String((sender && sender.phone) || "").trim();
    const siren = String((sender && sender.siren) || "").replace(/\D/g, "");
    const address = String((sender && sender.address) || "").trim();
    const identity = [role, companyName].filter(Boolean).join(", ");
    const contactLine = [email, phone].filter(Boolean).join(" - ");
    const sirenFmt = siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
    const legalBits = [];
    if (companyName) legalBits.push(companyName);
    if (sirenFmt) legalBits.push(`SIREN ${sirenFmt}`);
    if (address) legalBits.push(address);
    const legalLine = legalBits.length
      ? `${legalBits.join(", ")}. Origine des données : ${sourceLine(company)}`
      : `Origine des données : ${sourceLine(company)}`;
    return [
      "Bien cordialement,",
      name,
      identity,
      contactLine,
      legalLine,
      "Répondez « stop » pour ne plus être contacté."
    ].filter((line) => String(line || "").trim()).join("\n");
  }

  function shortCompanyName(company) {
    const name = String((company && company.name) || "Votre cabinet").trim();
    return name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim() || name;
  }

  function buildOutreachMail(company, sender, options) {
    const opts = options && typeof options === "object" ? options : {};
    const core = String(opts.bodyOverride || "").trim() || STANDARD_BODY;
    const focus = inferClientFocus(company);
    const subject = `${shortCompanyName(company)} — test gratuit sur la saisie des factures`;
    const body = [
      greeting(company),
      "",
      focus.hook,
      "",
      core,
      "",
      legalFooter(sender, company)
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return {
      kind: "outreach",
      subject,
      body,
      focusId: focus.id,
      hook: focus.hook
    };
  }

  function buildFollowUpMail(company, sender) {
    const subject = `Relance — ${shortCompanyName(company)} / démo L'ARC`;
    const body = [
      greeting(company),
      "",
      "Je me permets de revenir vers vous au sujet de L'ARC, l'agent qui propose les écritures comptables à partir de vos factures.",
      "",
      "Avez-vous pu parcourir mon précédent message ? Je reste disponible 10 minutes pour vous montrer la démo (FEC fictif, sans engagement).",
      "",
      legalFooter(sender, company)
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return {
      kind: "followup",
      subject,
      body,
      focusId: inferClientFocus(company).id
    };
  }

  return {
    CLIENT_FOCUS_HOOKS,
    DEFAULT_HOOK,
    STANDARD_BODY,
    inferClientFocus,
    buildOutreachMail,
    buildFollowUpMail,
    legalFooter,
    firstNameFromDirectors,
    sourceLine
  };
});
