import stations from './stations.generated.json';

export type Station = {
  runtime: 'host' | 'sandbox';
  model?: string;
  verify?: string;
  maxFixRounds?: number;
  template: string;
};

export type StationName = keyof typeof stations;

/** Untrusted values must not be able to close the <untrusted> block they are inserted into. */
const neutralize = (v: string | number) => String(v).replace(/<\/?untrusted>/gi, (t) => t.replace('<', '&lt;'));

export function renderStation(name: StationName, vars: Record<string, string | number>) {
  const s = stations[name] as Station;
  return { ...s, prompt: s.template.replace(/\{\{(\w+)\}\}/g, (_, k) => neutralize(vars[k] ?? '')) };
}
