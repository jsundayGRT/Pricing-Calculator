export type Scenario = {
  id: string;
  band: string;
  location: string;
  seats?: number;
  employees?: number;
  modules: string[];
  term: string;
  earlyPay: boolean;
  commandCenter: boolean;
  onPrem: boolean;
  scoped?: number;
  pilot: boolean;
  discount: number;
};

/** Realistic quotes. All US so the displayed total does not depend on a live FX rate. */
export const scenarios: Scenario[] = [
  {
    id: 'smb-shadow',
    band: 'SMB',
    location: 'US',
    employees: 80,
    modules: ['shadow'],
    term: '1-Year',
    earlyPay: false,
    commandCenter: true,
    onPrem: false,
    pilot: true,
    discount: 0,
  },
  {
    id: 'mid-market-suite',
    band: 'Mid-Market',
    location: 'US',
    employees: 400,
    modules: ['codeAi', 'shadow', 'drift', 'content'],
    term: '3+ Year',
    earlyPay: true,
    commandCenter: true,
    onPrem: false,
    pilot: true,
    discount: 10,
  },
  {
    id: 'enterprise-full',
    band: 'Enterprise',
    location: 'US',
    seats: 2500,
    modules: ['codeAi', 'shadow', 'drift', 'content', 'creative', 'aiq'],
    term: '2-Year',
    earlyPay: false,
    commandCenter: true,
    onPrem: false,
    pilot: false,
    discount: 5,
  },
  {
    id: 'corporate-onprem',
    band: 'Corporate',
    location: 'US',
    employees: 800,
    modules: ['content', 'aiq'],
    term: '1-Year',
    earlyPay: false,
    commandCenter: false,
    onPrem: true,
    scoped: 25000,
    pilot: false,
    discount: 0,
  },
  {
    id: 'micro-command-center',
    band: 'Micro',
    location: 'US',
    employees: 12,
    modules: [],
    term: '1-Year',
    earlyPay: true,
    commandCenter: true,
    onPrem: false,
    pilot: false,
    discount: 0,
  },
];
