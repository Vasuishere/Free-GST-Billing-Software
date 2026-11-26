import assert from 'node:assert/strict';
import test from 'node:test';
import { importBackupIntoSupabase } from '../src/utils/supabaseBackupImport.js';

class FakeSupabase {
  constructor(seed = {}) {
    this.tables = new Map(Object.entries(seed).map(([table, rows]) => [table, structuredClone(rows)]));
  }

  from(table) {
    const rows = this.tables.get(table) || [];
    this.tables.set(table, rows);
    const filters = [];
    const query = {
      select: () => query,
      eq: (field, value) => { filters.push((row) => row[field] === value); return query; },
      in: (field, values) => { filters.push((row) => values.includes(row[field])); return query; },
      maybeSingle: async () => ({ data: rows.find((row) => filters.every((filter) => filter(row))) || null, error: null }),
      upsert: async (incoming, { onConflict }) => {
        const keys = onConflict.split(',');
        for (const item of Array.isArray(incoming) ? incoming : [incoming]) {
          const index = rows.findIndex((row) => keys.every((key) => row[key] === item[key]));
          if (index < 0) rows.push(structuredClone(item));
          else rows[index] = { ...rows[index], ...structuredClone(item) };
        }
        return { error: null };
      },
      then: (resolve, reject) => Promise.resolve({
        data: rows.filter((row) => filters.every((filter) => filter(row))).map(({ id }) => ({ id })),
        error: null,
      }).then(resolve, reject),
    };
    return query;
  }
}

test('imports backup collections into Supabase, preserving existing records and counters', async () => {
  const client = new FakeSupabase({
    clients: [{ company_id: 'company-1', id: 'existing-client' }],
    app_settings: [{
      company_id: 'company-1',
      profile: {},
      meta: {
        counter_INV: 9,
        invoiceNumberSeries: { current: 3 },
        costCentres: [{ id: 'existing-centre' }],
      },
    }],
  });
  const toRow = (table, item, companyId, userId) => ({
    company_id: companyId,
    created_by: userId,
    id: item.id,
    data: item,
    ...(table === 'bills' ? { client_id: item.clientId || null } : {}),
    ...(table === 'purchases' ? { vendor_id: item.vendorId || null } : {}),
  });

  const result = await importBackupIntoSupabase(client, 'company-1', 'user-1', {
    profile: { businessName: 'Test Books' },
    clients: [
      { id: 'existing-client', name: 'Keep existing' },
      { id: 'new-client', name: 'New client' },
      { id: 'new-client', name: 'Duplicate client' },
    ],
    vendors: [{ id: 'vendor-1', name: 'Supplier' }],
    bills: [{ id: 'bill-1', clientId: 'new-client' }],
    purchases: [{ id: 'purchase-1', vendorId: 'vendor-1' }],
    termsTemplates: [{ id: 'template-1', name: 'Terms' }],
    meta: {
      counter_INV: 7,
      counter_PO: 2,
      invoiceNumberSeries: { previous: 1 },
      costCentres: [{ id: 'new-centre' }],
    },
  }, toRow);

  assert.equal(result.clientCount, 1);
  assert.equal(result.clientSkipped, 2);
  assert.equal(result.vendorCount, 1);
  assert.equal(result.billCount, 1);
  assert.equal(result.purchaseCount, 1);
  assert.equal(result.templateCount, 1);
  assert.equal(result.hasProfile, true);
  assert.equal(client.tables.get('clients').length, 2);
  assert.equal(client.tables.get('bills')[0].client_id, 'new-client');
  assert.equal(client.tables.get('purchases')[0].vendor_id, 'vendor-1');
  assert.equal(client.tables.get('company_documents')[0].collection, 'templates');

  const settings = client.tables.get('app_settings')[0];
  assert.equal(settings.profile.businessName, 'Test Books');
  assert.equal(settings.meta.counter_INV, 9);
  assert.equal(settings.meta.counter_PO, 2);
  assert.deepEqual(settings.meta.invoiceNumberSeries, { previous: 1, current: 3 });
  assert.deepEqual(settings.meta.costCentres.map((centre) => centre.id), ['existing-centre', 'new-centre']);
});

test('rejects malformed backup collections instead of reporting a successful import', async () => {
  const client = new FakeSupabase();
  await assert.rejects(
    importBackupIntoSupabase(client, 'company-1', 'user-1', { bills: {} }, () => ({})),
    /Backup bills must be a list/
  );
});
