import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const agent = await createAgent({
  name: 'currency-exchange',
  version: '1.0.0',
  description: 'Live currency exchange rates and conversion. Real-time forex data from European Central Bank via Frankfurter API.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

const FRANKFURTER_BASE = 'https://api.frankfurter.app';

async function fetchJSON(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// === FREE: Overview - Major currency rates ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview - current rates for major currencies (USD, EUR, GBP, JPY, CHF)',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const data = await fetchJSON(`${FRANKFURTER_BASE}/latest?from=USD&to=EUR,GBP,JPY,CHF,AUD,CAD`);
    return {
      output: {
        base: data.base,
        date: data.date,
        rates: data.rates,
        currencies: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD'],
        source: 'European Central Bank via Frankfurter API',
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID: Convert - Currency conversion ===
addEntrypoint({
  key: 'convert',
  description: 'Convert an amount from one currency to another',
  input: z.object({
    amount: z.number().positive(),
    from: z.string().length(3).toUpperCase(),
    to: z.string().length(3).toUpperCase(),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const { amount, from, to } = ctx.input;
    const data = await fetchJSON(`${FRANKFURTER_BASE}/latest?amount=${amount}&from=${from}&to=${to}`);
    return {
      output: {
        original: { amount, currency: from },
        converted: { amount: data.rates[to], currency: to },
        rate: data.rates[to] / amount,
        date: data.date,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID: Rates - Current rates for specific currencies ===
addEntrypoint({
  key: 'rates',
  description: 'Get current exchange rates for specific currencies',
  input: z.object({
    base: z.string().length(3).toUpperCase().default('USD'),
    targets: z.array(z.string().length(3)).optional(),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { base, targets } = ctx.input;
    let url = `${FRANKFURTER_BASE}/latest?from=${base}`;
    if (targets && targets.length > 0) {
      url += `&to=${targets.map(t => t.toUpperCase()).join(',')}`;
    }
    const data = await fetchJSON(url);
    return {
      output: {
        base: data.base,
        date: data.date,
        rates: data.rates,
        rateCount: Object.keys(data.rates).length,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID: History - Historical rates ===
addEntrypoint({
  key: 'history',
  description: 'Get historical exchange rates for a date range',
  input: z.object({
    base: z.string().length(3).toUpperCase().default('USD'),
    targets: z.array(z.string().length(3)),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const { base, targets, startDate, endDate } = ctx.input;
    const url = `${FRANKFURTER_BASE}/${startDate}..${endDate}?from=${base}&to=${targets.map(t => t.toUpperCase()).join(',')}`;
    const data = await fetchJSON(url);
    return {
      output: {
        base: data.base,
        startDate: data.start_date,
        endDate: data.end_date,
        rates: data.rates,
        dataPoints: Object.keys(data.rates).length,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID: Compare - Compare multiple currencies against base ===
addEntrypoint({
  key: 'compare',
  description: 'Compare exchange rates across multiple currencies with analysis',
  input: z.object({
    base: z.string().length(3).toUpperCase().default('USD'),
    currencies: z.array(z.string().length(3)).min(2).max(10),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { base, currencies } = ctx.input;
    const url = `${FRANKFURTER_BASE}/latest?from=${base}&to=${currencies.map(c => c.toUpperCase()).join(',')}`;
    const data = await fetchJSON(url);
    
    const rates = Object.entries(data.rates).map(([currency, rate]) => ({
      currency,
      rate: rate as number,
      inverse: 1 / (rate as number),
    }));
    
    const sorted = [...rates].sort((a, b) => b.rate - a.rate);
    
    return {
      output: {
        base: data.base,
        date: data.date,
        comparison: rates,
        strongest: sorted[sorted.length - 1],
        weakest: sorted[0],
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID: Report - Full currency report with trend data ===
addEntrypoint({
  key: 'report',
  description: 'Comprehensive currency report with current rates, 7-day history, and trend analysis',
  input: z.object({
    base: z.string().length(3).toUpperCase().default('USD'),
    targets: z.array(z.string().length(3)).min(1).max(5),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const { base, targets } = ctx.input;
    const targetsStr = targets.map(t => t.toUpperCase()).join(',');
    
    // Get current rates
    const currentUrl = `${FRANKFURTER_BASE}/latest?from=${base}&to=${targetsStr}`;
    const current = await fetchJSON(currentUrl);
    
    // Get 7-day history
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const historyUrl = `${FRANKFURTER_BASE}/${weekAgo.toISOString().split('T')[0]}..${today.toISOString().split('T')[0]}?from=${base}&to=${targetsStr}`;
    const history = await fetchJSON(historyUrl);
    
    // Calculate trends
    const trends: Record<string, { current: number; weekAgo: number; change: number; changePercent: string }> = {};
    const historyDates = Object.keys(history.rates).sort();
    const firstDate = historyDates[0];
    const lastDate = historyDates[historyDates.length - 1];
    
    for (const currency of targets.map(t => t.toUpperCase())) {
      const currentRate = current.rates[currency];
      const oldRate = history.rates[firstDate]?.[currency];
      if (currentRate && oldRate) {
        const change = currentRate - oldRate;
        const changePercent = ((change / oldRate) * 100).toFixed(2);
        trends[currency] = {
          current: currentRate,
          weekAgo: oldRate,
          change,
          changePercent: `${change >= 0 ? '+' : ''}${changePercent}%`,
        };
      }
    }
    
    return {
      output: {
        base,
        currentRates: current.rates,
        currentDate: current.date,
        trends,
        history: {
          startDate: firstDate,
          endDate: lastDate,
          dataPoints: historyDates.length,
          rates: history.rates,
        },
        source: 'European Central Bank via Frankfurter API',
        generatedAt: new Date().toISOString(),
      },
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`Currency Exchange Agent running on port ${port}`);

export default { port, fetch: app.fetch };
