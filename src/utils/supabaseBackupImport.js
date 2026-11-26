const IMPORT_BATCH_SIZE = 200;

const IMPORT_COLLECTIONS = [
  { field: 'clients', table: 'clients', count: 'clientCount' },
  { field: 'vendors', table: 'vendors', count: 'vendorCount' },
  { field: 'products', table: 'products', count: 'productCount' },
  { field: 'bills', table: 'bills', count: 'billCount' },
  { field: 'purchases', table: 'purchases', count: 'purchaseCount' },
  { field: 'purchaseOrders', collection: 'purchase-orders', count: 'purchaseOrderCount' },
  { field: 'expenses', table: 'expenses', count: 'expenseCount' },
  { field: 'receipts', table: 'receipts', count: 'receiptCount' },
  { field: 'termsTemplates', collection: 'templates', count: 'templateCount' },
  { field: 'recurring', collection: 'recurring', count: 'recurringCount' },
  { field: 'profiles', collection: 'profiles', count: 'profileCount' },
  { field: 'productions', collection: 'productions', count: 'productionCount' },
  { field: 'cashBook', collection: 'cash-book', count: 'cashBookCount' },
  { field: 'debitNotes', collection: 'debit-notes', count: 'debitNoteCount' },
  { field: 'bankStatements', collection: 'bank-statements', count: 'bankStatementCount' },
  { field: 'stockAdjustments', collection: 'stock-adjustments', count: 'stockAdjustmentCount' },
];

const emptyCounts = () => {
  const counts = { hasProfile: false };
  for (const { count } of IMPORT_COLLECTIONS) {
    counts[count] = 0;
    counts[count.replace(/Count$/, 'Skipped')] = 0;
  }
  return counts;
};

async function findExistingIds(client, table, companyId, ids, collection) {
  const existing = new Set();
  for (let i = 0; i < ids.length; i += IMPORT_BATCH_SIZE) {
    let query = client.from(table)
      .select('id')
      .eq('company_id', companyId);
    if (collection) query = query.eq('collection', collection);
    const { data, error } = await query.in('id', ids.slice(i, i + IMPORT_BATCH_SIZE));
    if (error) throw new Error(`Could not check existing ${collection || table}: ${error.message}`);
    for (const row of data || []) existing.add(row.id);
  }
  return existing;
}

async function importCollection(client, data, config, companyId, userId, toRow, counts) {
  const records = data[config.field];
  if (records === undefined) return;
  if (!Array.isArray(records)) throw new Error(`Backup ${config.field} must be a list`);

  const countKey = config.count;
  const skippedKey = countKey.replace(/Count$/, 'Skipped');
  const unique = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.id || seen.has(String(record.id))) {
      counts[skippedKey]++;
      continue;
    }
    seen.add(String(record.id));
    unique.push(record);
  }
  if (!unique.length) return;

  const table = config.table || 'company_documents';
  const existing = await findExistingIds(
    client,
    table,
    companyId,
    unique.map((record) => String(record.id)),
    config.collection
  );
  const pending = unique.filter((record) => !existing.has(String(record.id)));
  counts[skippedKey] += unique.length - pending.length;

  for (let i = 0; i < pending.length; i += IMPORT_BATCH_SIZE) {
    const batch = pending.slice(i, i + IMPORT_BATCH_SIZE);
    const rows = config.collection
      ? batch.map((item) => ({
          company_id: companyId,
          collection: config.collection,
          id: String(item.id),
          data: { ...item, id: String(item.id) },
          created_by: userId,
        }))
      : batch.map((item) => toRow(config.table, item, companyId, userId));
    const conflict = config.collection ? 'company_id,collection,id' : 'company_id,id';
    const { error } = await client.from(table).upsert(rows, { onConflict: conflict });
    if (error) throw new Error(`Failed importing ${config.field}: ${error.message}`);
    counts[countKey] += rows.length;
  }
}

function mergeImportedMeta(imported, current) {
  const merged = { ...(imported || {}), ...(current || {}) };
  merged.invoiceNumberSeries = {
    ...(imported?.invoiceNumberSeries || {}),
    ...(current?.invoiceNumberSeries || {}),
  };
  const importedCentres = Array.isArray(imported?.costCentres) ? imported.costCentres : [];
  const currentCentres = Array.isArray(current?.costCentres) ? current.costCentres : [];
  if (importedCentres.length || currentCentres.length) {
    const currentIds = new Set(currentCentres.map((centre) => centre?.id).filter(Boolean));
    merged.costCentres = [
      ...currentCentres,
      ...importedCentres.filter((centre) => centre?.id && !currentIds.has(centre.id)),
    ];
  }
  for (const [key, value] of Object.entries(imported || {})) {
    if (key.startsWith('counter_')) {
      merged[key] = Math.max(Number(current?.[key]) || 0, Number(value) || 0);
    }
  }
  return merged;
}

export async function importBackupIntoSupabase(client, companyId, userId, data, toRow) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup data must be an object');
  }
  const counts = emptyCounts();

  for (const config of IMPORT_COLLECTIONS) {
    await importCollection(client, data, config, companyId, userId, toRow, counts);
  }

  if (data.profile || data.meta) {
    const { data: current, error } = await client.from('app_settings')
      .select('profile, meta')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw new Error(`Could not read company settings: ${error.message}`);

    const patch = { company_id: companyId };
    if (data.profile && !Object.keys(current?.profile || {}).length) {
      patch.profile = data.profile;
      counts.hasProfile = true;
    }
    if (data.meta) patch.meta = mergeImportedMeta(data.meta, current?.meta);
    if (Object.keys(patch).length > 1) {
      const { error: upsertError } = await client.from('app_settings')
        .upsert(patch, { onConflict: 'company_id' });
      if (upsertError) throw new Error(`Failed importing company settings: ${upsertError.message}`);
    }
  }

  return counts;
}
