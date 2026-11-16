import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { adminEmails } from '@/lib/admin';
import { readSession } from '@/lib/session';

// How to use the calculator, and where feedback goes (FEEDBACK_EMAIL, else the first built-in admin).
export default async function HelpPage() {
  const user = await readSession();
  if (!user) redirect('/login');
  const to = process.env.FEEDBACK_EMAIL?.trim() || adminEmails()[0];
  const feedback = `mailto:${to}?subject=${encodeURIComponent('Pricing Calculator feedback')}`;

  return (
    <>
      <AppHeader user={user} />
      <main className="page help">
        <div className="page-head">
          <div>
            <h1>Help &amp; feedback</h1>
          </div>
          <a className="btn primary" href={feedback}>Send feedback</a>
        </div>

        <div className="card">
          <h2>Price a deal</h2>
          <ol>
            <li>Enter the number of employees. The band is picked for you; the price changes when the count moves into another band.</li>
            <li>Choose the buyer location, then the Traffic Light modules and AI Command Center.</li>
            <li>Set the contract term, Early Pay and any additional discount. Pricing beyond the standard limits is flagged as Deal Review.</li>
          </ol>
        </div>

        <div className="card">
          <h2>Send it for review</h2>
          <ol>
            <li>Enter the customer name and check the valid-until date.</li>
            <li>Press <b>Send for review</b>. Every proposal is reviewed before it goes to a customer; it is saved to your Dashboard.</li>
            <li>Once it&apos;s approved, download the <b>Proposal (Word)</b> from your Dashboard, check it, save it as a PDF and send it. The quote PDF is there too.</li>
          </ol>
          <p className="sub">Just pricing it out? Use <b>Sample PDF</b> or <b>Sample Word</b> for an estimate: nothing is saved.</p>
        </div>

        <div className="card">
          <h2>Review</h2>
          <p>An admin approves or declines each request, and looks harder at a large discount or a non-standard pilot.
            You&apos;ll hear about the decision by email or in Slack; choose which in the menu under your name.</p>
        </div>

        <div className="card">
          <h2>Change a locked request</h2>
          <p>On the Dashboard, <b>Open / revise</b> loads a request into the calculator; locking again saves the next
            version, and earlier versions stay as they are. <b>Duplicate</b> starts a new request with the same setup.</p>
        </div>

        <p className="sub">Something wrong or missing? <a href={feedback}>Send feedback</a> to {to}.</p>
      </main>
    </>
  );
}
