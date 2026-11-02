import type { ProviderAdapter } from '../../packages/contracts/src/provider-contract.ts';
export class ProviderRegistry {
  private entries = new Map<string, ProviderAdapter>();
  register(adapter: ProviderAdapter) {
    if (!adapter.name || !adapter.domain || !adapter.version || typeof adapter.invoke !== 'function')
      throw new TypeError('INVALID_ADAPTER');
    if (this.entries.has(adapter.name)) throw new Error('DUPLICATE_PROVIDER');
    this.entries.set(adapter.name, adapter);
    return adapter;
  }
  get(name: string) {
    const found = this.entries.get(name);
    if (!found) throw new Error('PROVIDER_NOT_REGISTERED');
    return found;
  }
  list() {
    return [...this.entries.values()].map((a) => ({
      name: a.name,
      domain: a.domain,
      provider_id: a.name,
      provider_category: a.domain,
      provider_version: a.version,
      mode: a.mode,
      capability: a.capability,
      ...a.getStatus(),
    }));
  }
  forDomain(domain: string) {
    const found = [...this.entries.values()].filter((a) => a.domain === domain);
    if (found.length !== 1) throw new Error('PROVIDER_SELECTION_REQUIRED');
    return found[0]!;
  }
}
