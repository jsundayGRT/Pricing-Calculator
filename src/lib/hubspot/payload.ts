// Turns a locked request into HubSpot line items. Reads ONLY snapshot.customer (what the
// customer sees on the quote PDF); snapshot.internal (cost, margin, discount caps) is never
// touched, so nothing executive-only can reach HubSpot.

export type LineItemPayload = {
  name: string;
  quantity: number;
  price: number; // list price per unit, in the quote currency
  discount: number; // discount per unit, in the quote currency
  recurring: boolean;
  description: string;
};

export type QuotePricing = {
  currency: string;
  lineItems: LineItemPayload[];
  total: number; // Year 1 total after all discounts (matches the PDF's final price)
  termMonths: number;
};

type Obj = Record<string, unknown>;

function num(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function buildQuotePricing(snapshot: Obj): QuotePricing {
  const c = (snapshot.customer || {}) as Obj;
  const lines = (c.lines || {}) as Obj;
  // Same fallback the calculator uses for requests locked before the `display` view existed.
  const view = (c.display || {
    modules: lines.modules,
    trafficLightAfterBundle: lines.trafficLightAfterBundle,
    commandCenter: lines.commandCenter,
    customerSuccess: lines.customerSuccess,
  }) as Obj;
  const fx = (c.fx || {}) as Obj;
  const rate = num(fx.rate) > 0 ? num(fx.rate) : 1;
  const currency = num(fx.rate) > 0 && typeof fx.currency === 'string' ? fx.currency : 'USD';
  const included = (c.included || {}) as Obj;
  const schedule = (c.schedule || {}) as Obj;
  const years = Math.max(1, num(schedule.years) || 1);
  const term = String(c.term || '');

  const modules = (Array.isArray(view.modules) ? view.modules : []) as Obj[];
  const selected = modules.filter((m) => m.selected && num(m.price) > 0);
  const moduleList = selected.reduce((s, m) => s + num(m.price), 0);
  // Bundle discount applies to the Traffic Light modules only.
  const moduleFactor = moduleList > 0 ? num(view.trafficLightAfterBundle) / moduleList : 1;

  type Raw = { name: string; list: number; afterBundle: number; recurring: boolean; description: string };
  const raw: Raw[] = [];
  const seats = num(included.governedEmployees);
  const devSeats = num(included.developerWorkseats);
  for (const m of selected) {
    const basis = m.key === 'codeAi' ? `${devSeats.toLocaleString('en-US')} developer seats` : `${seats.toLocaleString('en-US')} governed employees`;
    raw.push({ name: String(m.name), list: num(m.price), afterBundle: num(m.price) * moduleFactor, recurring: true, description: `Annual, ${basis}` });
  }
  const add = (name: string, amount: number, recurring: boolean, description: string) => {
    if (amount > 0) raw.push({ name, list: amount, afterBundle: amount, recurring, description });
  };
  add('AI Command Center', num(view.commandCenter), true, 'Annual platform fee');
  add('Premium support and named Customer Success', num(lines.premiumSupport), true, 'Annual');
  add('Customer Success', num(view.customerSuccess), true, 'Annual');
  add('Inference', num(lines.inference), true, 'Annual');
  add('Dedicated SaaS tenant / Security (scoped)', num(lines.dedicatedTenant), true, 'Annual');
  add('Implementation', num(c.implementation), false, 'One-time, Year 1 only');

  // Early Pay, multi-year and additional discounts apply to the whole subtotal after the
  // bundle discount. Derive one factor from the customer-facing totals so the line items add
  // up to the final price on the PDF.
  const subtotal = raw.reduce((s, r) => s + r.afterBundle, 0);
  const finalPrice = num(c.finalPrice);
  const k = subtotal > 0 ? finalPrice / subtotal : 1;

  const lineItems = raw.map((r) => {
    const price = cents(r.list * rate);
    const net = cents(r.afterBundle * k * rate);
    return {
      name: r.name,
      quantity: 1,
      price,
      discount: cents(Math.max(0, price - net)),
      recurring: r.recurring,
      description: r.recurring && term ? `${r.description} · ${term} term` : r.description,
    };
  });
  const total = cents(lineItems.reduce((s, li) => s + li.price * li.quantity - li.discount, 0));
  return { currency, lineItems, total, termMonths: years * 12 };
}

// HubSpot property names for one line item.
export function lineItemProperties(li: LineItemPayload, currency: string, termMonths: number) {
  return {
    name: li.name,
    quantity: String(li.quantity),
    price: li.price.toFixed(2),
    discount: li.discount.toFixed(2),
    description: li.description,
    hs_line_item_currency_code: currency,
    ...(li.recurring
      ? { recurringbillingfrequency: 'annually', hs_recurring_billing_period: `P${termMonths}M` }
      : {}),
  };
}
