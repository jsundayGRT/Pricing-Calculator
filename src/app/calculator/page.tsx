import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { readSession } from '@/lib/session';

export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ revise?: string; copy?: string }>;
}) {
  const user = await readSession();
  if (!user) redirect('/login');
  const params = await searchParams;
  // ?revise= opens a request to lock its next version; ?copy= starts a new request from one.
  const revise = params.revise
    ? `?revise=${encodeURIComponent(params.revise)}`
    : params.copy ? `?copy=${encodeURIComponent(params.copy)}` : '';

  return (
    <>
      <AppHeader user={user} active="calculator" />
      <iframe
        className="calc-frame"
        title="Pricing calculator"
        src={`/api/calculator${revise}`}
      />
    </>
  );
}
