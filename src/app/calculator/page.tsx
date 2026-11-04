import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { readSession } from '@/lib/session';

export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ revise?: string }>;
}) {
  const user = await readSession();
  if (!user) redirect('/login');
  const params = await searchParams;
  const revise = params.revise ? `?revise=${encodeURIComponent(params.revise)}` : '';

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
