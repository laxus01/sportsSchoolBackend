import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MySQL licensing migration', () => {
  it('declares both license terms and protects one-time perpetual payments', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'src/database/migrations/1730000000000-InitialLicensingSchema.ts',
      ),
      'utf8',
    );
    expect(migration).toContain("'SUBSCRIPTION', 'PERPETUAL'");
    expect(migration).toContain('PERPETUAL_LICENSE');
    expect(migration).toContain('uq_payments_perpetual_license');
    expect(migration).toContain('offline_until IS NULL');
    expect(migration).not.toMatch(/(^|\n)\s*DROP\s+TABLE/im);
  });
});
