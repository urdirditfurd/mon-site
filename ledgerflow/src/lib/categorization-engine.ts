import { z } from "zod";

export const llmCategorySchema = z.object({
  accountNumber: z.string().min(3),
  accountName: z.string().min(1),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().min(1),
});

export type LlmCategoryResult = z.infer<typeof llmCategorySchema>;

export type CategorizationSource =
  | "RULE"
  | "HEURISTIC"
  | "LLM"
  | "FALLBACK"
  | "MANUAL";

export interface PcgAccountRef {
  id: string;
  number: string;
  label: string;
}

export interface CategorizationRuleRef {
  id: string;
  keyword: string;
  accountId: string;
  priority: number;
  account: PcgAccountRef;
}

export interface CategorySuggestion {
  accountId: string;
  accountNumber: string;
  accountName: string;
  confidence: number;
  reason: string;
  source: CategorizationSource;
  keywordMatched?: string;
}

const FALLBACK_NUMBER = "671000";

/** Heuristiques métier françaises (sans LLM) — confiance moyenne/haute. */
const BUILTIN_HEURISTICS: Array<{
  pattern: RegExp;
  accountNumber: string;
  reason: string;
  confidence: number;
}> = [
  {
    pattern: /spotify|netflix|disney\+|deezer|apple\s*music/i,
    accountNumber: "626000",
    reason: "Abonnement numérique / télécom",
    confidence: 88,
  },
  {
    pattern: /aws|amazon\s*web|ovh|azure|google\s*cloud|digitalocean/i,
    accountNumber: "626000",
    reason: "Infrastructure cloud / télécom & services numériques",
    confidence: 85,
  },
  {
    pattern: /urssaf|agirc|arrco|retraite/i,
    accountNumber: "641000",
    reason: "Charges sociales / rémunération du personnel",
    confidence: 90,
  },
  {
    pattern: /sncf|uber|bolt|taxi|peage|péage|esso|total\s*energies|station/i,
    accountNumber: "625000",
    reason: "Déplacements, missions",
    confidence: 86,
  },
  {
    pattern: /amazon(?!\s*web)|fnac|ikea|leroy|fourniture|papeterie/i,
    accountNumber: "606000",
    reason: "Achats non stockés / fournitures",
    confidence: 75,
  },
  {
    pattern: /salaire|paie|payroll/i,
    accountNumber: "641000",
    reason: "Rémunération du personnel",
    confidence: 92,
  },
  {
    pattern: /frais.*(compte|tenue)|commission\s*bancaire/i,
    accountNumber: "627000",
    reason: "Services bancaires",
    confidence: 90,
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function findAccount(
  accounts: PcgAccountRef[],
  number: string,
): PcgAccountRef | undefined {
  return accounts.find((a) => a.number === number || a.number.startsWith(number));
}

/**
 * 1) Règle personnalisée (mémoire) → 2) Heuristique → 3) LLM optionnel → 4) Fallback 671000
 */
export async function categorizeTransaction(
  label: string,
  amount: number,
  accounts: PcgAccountRef[],
  rules: CategorizationRuleRef[],
  options?: { enableLlm?: boolean },
): Promise<CategorySuggestion> {
  const hay = normalize(label);

  // 1. Règles apprises (priorité croissante = plus prioritaire si priority plus bas)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sortedRules) {
    if (hay.includes(normalize(rule.keyword))) {
      return {
        accountId: rule.account.id,
        accountNumber: rule.account.number,
        accountName: rule.account.label,
        confidence: 100,
        reason: `Règle personnalisée (« ${rule.keyword} »)`,
        source: "RULE",
        keywordMatched: rule.keyword,
      };
    }
  }

  // 2. Heuristiques métier
  for (const heuristic of BUILTIN_HEURISTICS) {
    if (heuristic.pattern.test(label)) {
      const account = findAccount(accounts, heuristic.accountNumber);
      if (account) {
        return {
          accountId: account.id,
          accountNumber: account.number,
          accountName: account.label,
          confidence: heuristic.confidence,
          reason: heuristic.reason,
          source: "HEURISTIC",
        };
      }
    }
  }

  // 3. LLM si clé API présente
  if (options?.enableLlm !== false) {
    const llm = await tryLlmCategorization(label, amount, accounts);
    if (llm) return llm;
  }

  // 4. Fallback prudent
  const fallback =
    findAccount(accounts, FALLBACK_NUMBER) ??
    findAccount(accounts, "671") ??
    accounts[0];

  if (!fallback) {
    return {
      accountId: "",
      accountNumber: FALLBACK_NUMBER,
      accountName: "Charges exceptionnelles",
      confidence: 30,
      reason: "Défaut (à vérifier) — aucun compte PCG en base",
      source: "FALLBACK",
    };
  }

  return {
    accountId: fallback.id,
    accountNumber: fallback.number,
    accountName: fallback.label,
    confidence: 30,
    reason: "Défaut (à vérifier) — aucune règle ni heuristique",
    source: "FALLBACK",
  };
}

async function tryLlmCategorization(
  label: string,
  amount: number,
  accounts: PcgAccountRef[],
): Promise<CategorySuggestion | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const catalog = accounts
    .map((a) => `${a.number} — ${a.label}`)
    .slice(0, 40)
    .join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Tu es un expert-comptable français. Analyse ce libellé bancaire et ce montant. Propose le numéro et le nom du compte du PCG le plus adapté parmi la liste fournie. Réponds UNIQUEMENT en JSON : { accountNumber: string, accountName: string, confidence: number, reasoning: string }",
          },
          {
            role: "user",
            content: `Libellé: ${label}\nMontant: ${amount} EUR\nComptes disponibles:\n${catalog}`,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = llmCategorySchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;

    const account = findAccount(accounts, parsed.data.accountNumber);
    if (!account) return null;

    return {
      accountId: account.id,
      accountNumber: account.number,
      accountName: account.label,
      confidence: Math.min(95, Math.max(40, parsed.data.confidence)),
      reason: parsed.data.reasoning,
      source: "LLM",
    };
  } catch {
    return null;
  }
}

/** Extrait un mot-clé mémorisable depuis un libellé bancaire. */
export function extractMemorableKeyword(label: string): string {
  const stop = new Set([
    "VIR",
    "VIREMENT",
    "PRLV",
    "PRELEVEMENT",
    "CARTE",
    "CB",
    "PAIEMENT",
    "SEPA",
    "EUR",
    "FR",
    "DE",
    "LA",
    "LE",
    "LES",
    "ET",
  ]);
  const tokens = normalize(label)
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
  return tokens[0] ?? normalize(label).slice(0, 24);
}
