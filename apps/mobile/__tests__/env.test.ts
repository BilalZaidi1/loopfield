import { assertNoSecrets } from '@/config/env';

describe('client configuration guard', () => {
  it('accepts client-safe identifiers', () => {
    expect(() => assertNoSecrets({ a: 'pk.eyJ1IjoibG9vcGZpZWxkIn0', b: 'sb_publishable_abc', c: 'phc_123', d: 'appl_xyz' })).not.toThrow();
  });
  it.each([['sk_live_123'], ['sb_secret_abc'], ['whsec_abc'], ['re_ABCDEFGHIJKLMN'], ['eyJ...service_role...']])('refuses to start with a server secret (%s)', (value) => {
    expect(() => assertNoSecrets({ X: value })).toThrow(/server secret/);
  });
});
