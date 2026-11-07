import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminService } from '../src/services/admin-service.js';

function fakePool(queryHandler) {
  const client = {
    query: queryHandler,
    release() {},
  };
  return { connect: async () => client };
}

test('perpetual school creation has no paid-through, grace or offline dates', async () => {
  const calls = [];
  const pool = fakePool(async (sql, values = []) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    return { rows: [] };
  });
  const service = createAdminService({
    pool,
    config: { activationCodeTtlHours: 72 },
  });

  const result = await service.createSchool(
    { name: 'Escuela Nueva', licenseType: 'PERPETUAL' },
    'owner-id',
  );
  const licenseInsert = calls.find(({ query }) =>
    query.startsWith('INSERT INTO licenses'),
  );

  assert.match(result.schoolId, /^[0-9a-f-]{36}$/i);
  assert.match(result.licenseId, /^[0-9a-f-]{36}$/i);
  assert.equal(licenseInsert.values[2], 'PERPETUAL');
  assert.equal(licenseInsert.values[3], null);
  assert.equal(licenseInsert.values[4], null);
  assert.equal(licenseInsert.values[5], null);
});

test('perpetual purchase records a one-time payment without a period', async () => {
  const calls = [];
  const pool = fakePool(async (sql, values = []) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.startsWith('SELECT id, school_id, license_type')) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          school_id: '22222222-2222-4222-8222-222222222222',
          license_type: 'PERPETUAL',
          status: 'PENDING_PAYMENT',
        }],
      };
    }
    if (query.startsWith('SELECT id, amount_cop')) return { rows: [] };
    return { rows: [] };
  });
  const service = createAdminService({
    pool,
    config: { activationCodeTtlHours: 72 },
  });

  const payment = await service.recordPayment(
    '11111111-1111-4111-8111-111111111111',
    {
      paymentType: 'PERPETUAL_LICENSE',
      amountCop: 1_500_000,
      currency: 'COP',
      paymentMethod: 'BANK_TRANSFER',
      periodStartDate: null,
      periodEndDate: null,
    },
    'perpetual-payment-001',
    'owner-id',
  );
  const paymentInsert = calls.find(({ query }) =>
    query.startsWith('INSERT INTO payments'),
  );
  const licenseUpdate = calls.find(({ query }) =>
    query.startsWith('UPDATE licenses'),
  );

  assert.equal(payment.replayed, false);
  assert.equal(paymentInsert.values[4], 'PERPETUAL_LICENSE');
  assert.equal(paymentInsert.values[7], null);
  assert.equal(paymentInsert.values[8], null);
  assert.match(licenseUpdate.query, /SET status = 'ACTIVE'/);
});
