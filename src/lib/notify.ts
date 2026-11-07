import { emailDecisionToRep } from './email';
import { notifyRepInSlack } from './slack';

// Tells the rep their Deal Review was decided: a Slack message from the app (and an email, once
// MAIL_FROM is set up). Neither ever throws.
export async function notifyRepOfDecision(id: string, appUrl: string) {
  await notifyRepInSlack(id, appUrl);
  await emailDecisionToRep(id, appUrl);
}
