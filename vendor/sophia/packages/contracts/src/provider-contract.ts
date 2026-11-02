export const PROVIDER_RESULT_CODES = [
  'SUCCESS',
  'PARTIAL',
  'TIMEOUT',
  'RATE_LIMITED',
  'AUTH_FAILED',
  'PROVIDER_DOWN',
  'INVALID_RESPONSE',
  'CONFIG_NOT_READY',
  'FALLBACK_USED',
] as const;
export type ProviderCode = (typeof PROVIDER_RESULT_CODES)[number];
export interface ProviderResult {
  code: ProviderCode;
  data: unknown;
  message: string;
  meta: Record<string, unknown>;
  ts: string;
}
export interface ProviderInput {
  simulate?: ProviderCode | Lowercase<ProviderCode>;
  query?: string;
}
export interface ProviderAdapter {
  name: string;
  domain: string;
  version: string;
  mode: 'mock' | 'disabled';
  capability: readonly string[];
  getStatus(): { configReady: boolean; health: string };
  invoke(input?: ProviderInput): Promise<ProviderResult>;
}
export function createProviderResult(
  code: ProviderCode,
  data: unknown = null,
  clock: () => Date = () => new Date(),
): ProviderResult {
  if (!PROVIDER_RESULT_CODES.includes(code)) throw new TypeError('INVALID_PROVIDER_CODE');
  return { code, data, message: code, meta: { contract_version: 1 }, ts: clock().toISOString() };
}
