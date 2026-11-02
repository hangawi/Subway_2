import {
  createProviderResult,
  PROVIDER_RESULT_CODES,
  type ProviderCode,
  type ProviderAdapter,
} from '../../packages/contracts/src/provider-contract.ts';
import { ProviderRegistry } from './registry.ts';
export function createMock(name: string, domain: string, clock: () => Date = () => new Date()): ProviderAdapter {
  return {
    name,
    domain,
    version: '1.0.0',
    mode: 'mock',
    capability: domain === 'llm' ? ['text-completion'] : ['transit-route-lookup'],
    getStatus: () => ({ configReady: true, health: 'mock_ready' }),
    async invoke(input = {}) {
      const simulated = input.simulate?.toUpperCase() as ProviderCode | undefined;
      if (simulated && !PROVIDER_RESULT_CODES.includes(simulated))
        return createProviderResult('INVALID_RESPONSE', null, clock);
      const result = createProviderResult(simulated ?? 'SUCCESS', null, clock);
      result.meta = { ...result.meta, mock: true, live_data: false };
      if (['SUCCESS', 'PARTIAL', 'FALLBACK_USED'].includes(result.code))
        result.data =
          domain === 'llm'
            ? {
                intent: 'SCHEDULE_REQUEST',
                entities: { activity: '등산' },
                conditions: { time_expression: '토요일 저녁' },
                emotion_evidence: [],
                confidence: null,
                mock: true,
              }
            : {
                provider_source: 'TAGO_MOCK',
                stop_id: 'fixture-stop-1',
                routes: [{ route_id: 'fixture-route-1' }],
                retrieved_at: clock().toISOString(),
                freshness: 'fixture_only',
                availability: 'mock_available',
                mock: true,
              };
      return result;
    },
  };
}
export const mapGeoPlaceholder: ProviderAdapter = {
  name: 'mapgeo-placeholder',
  domain: 'mapgeo',
  version: '1.0.0',
  mode: 'disabled',
  capability: [],
  getStatus: () => ({ configReady: false, health: 'not_configured' }),
  async invoke(input = {}) {
    const code = input.simulate?.toUpperCase() as ProviderCode | undefined;
    const result = createProviderResult(
      code ? (PROVIDER_RESULT_CODES.includes(code) ? code : 'INVALID_RESPONSE') : 'CONFIG_NOT_READY',
    );
    result.meta = { ...result.meta, mock: true, live_data: false };
    return result;
  },
};
export function createDefaultRegistry() {
  const r = new ProviderRegistry();
  r.register(createMock('llm-mock', 'llm'));
  r.register(createMock('tago-mock', 'tago'));
  r.register(mapGeoPlaceholder);
  return r;
}
