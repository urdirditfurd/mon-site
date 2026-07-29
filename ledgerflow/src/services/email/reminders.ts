/**
 * Relances email programmables (J+7, J+15, J+30).
 */

export interface ReminderPlan {
  offsetDays: number;
  subject: string;
}

export const DEFAULT_REMINDER_PLAN: ReminderPlan[] = [
  {
    offsetDays: 7,
    subject: "Rappel amical — facture échue",
  },
  {
    offsetDays: 15,
    subject: "Deuxième rappel — règlement en attente",
  },
  {
    offsetDays: 30,
    subject: "Mise en demeure — facture impayée",
  },
];

export function buildReminderSchedule(dueDateIso: string): Array<{
  scheduledAt: string;
  offsetDays: number;
  subject: string;
}> {
  const due = new Date(dueDateIso);
  return DEFAULT_REMINDER_PLAN.map((step) => {
    const scheduled = new Date(due);
    scheduled.setDate(scheduled.getDate() + step.offsetDays);
    return {
      scheduledAt: scheduled.toISOString(),
      offsetDays: step.offsetDays,
      subject: step.subject,
    };
  });
}
