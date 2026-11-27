import { supabase, isSupabaseConfigured } from './supabaseClient';
import { importBackupIntoSupabase } from './supabaseBackupImport';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
let cachedCompanyId = null;

export function clearSupabaseSessionCache() {
  cachedCompanyId = null;
}

function maskVal(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  return s.length <= 4 ? '•'.repeat(s.length) : '•'.repeat(Math.min(12, s.length - 4)) + s.slice(-4);
}

function sanitiseVendor(v) {
  const b = v?.bankDetails || {};
  const acc = b.accountNumber || '';
  const route = b.routingCode || '';
  return {
    ...v,
    bankDetails: {
      accountHolderName: b.accountHolderName || '',
      bankName: b.bankName || '',
      accountNumberMasked: acc ? maskVal(acc) : (b.accountNumberMasked || ''),
      routingCodeMasked: route ? maskVal(route) : (b.routingCodeMasked || ''),
      hasAccountNumber: !!(acc || b.hasAccountNumber),
      hasRoutingCode: !!(route || b.hasRoutingCode),
    },
  };
}

export async function ensureActiveCompanyId() {
  if (!supabase) throw new Error('Supabase is not configured');
  if (cachedCompanyId) return cachedCompanyId;

  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);
  if (compErr) throw new Error(compErr.message);

  if (companies && companies.length > 0) {
    cachedCompanyId = companies[0].id;
    return cachedCompanyId;
  }

  const { error: insertErr } = await supabase
    .from('companies')
    .upsert({ id: DEFAULT_COMPANY_ID, name: 'Default Company' }, { onConflict: 'id' });
  if (insertErr) throw new Error(insertErr.message);

  await supabase
    .from('app_settings')
    .upsert({ company_id: DEFAULT_COMPANY_ID }, { onConflict: 'company_id' });

  cachedCompanyId = DEFAULT_COMPANY_ID;
  return cachedCompanyId;
}

const CORE_TABLES = new Set([
  'clients', 'vendors', 'products', 'bills', 'purchases',
  'purchase-orders', 'expenses', 'receipts',
]);

const DOC_COLLECTIONS = new Set([
  'templates', 'recurring', 'profiles', 'productions',
  'cash-book', 'debit-notes', 'bank-statements', 'stock-adjustments',
]);

function tableNameFor(col) {
  return col === 'purchase-orders' ? 'purchase_orders' : col;
}

function safeDate(val) {
  const s = String(val || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeIntOrNull(val) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toRow(col, item, companyId, userId) {
  const id = String(item.id || `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const payload = { ...item, id };
  const base = { company_id: companyId, id, data: payload, created_by: userId };

  if (col === 'clients') {
    return {
      ...base,
      name: payload.name || '',
      gstin: payload.gstin || '',
      email: payload.email || '',
      phone: payload.phone || '',
      billing_address: payload.billingAddress || {},
      shipping_addresses: payload.shippingAddresses || [],
    };
  }
  if (col === 'vendors') {
    return {
      ...base,
      name: payload.name || '',
      contact_person: payload.contactPerson || '',
      gstin: payload.gstin || '',
      email: payload.email || '',
      phone: payload.phone || '',
      payment_terms_days: safeIntOrNull(payload.paymentTermsDays),
      bank_details: payload.bankDetails || {},
    };
  }
  if (col === 'products') {
    return {
      ...base,
      name: payload.name || '',
      hsn: payload.hsn || '',
      purchase_price: Number(payload.purchasePrice) || 0,
      selling_price: Number(payload.sellingPrice ?? payload.rate) || 0,
      tax_percent: Number(payload.taxPercent) || 0,
      stock: Number(payload.stock) || 0,
      unit: payload.unit || 'Nos',
    };
  }
  if (col === 'bills') {
    return {
      ...base,
      client_id: payload.client?.id || payload.clientId || null,
      invoice_number: payload.invoiceNumber || '',
      invoice_type: payload.invoiceType || 'tax-invoice',
      invoice_date: safeDate(payload.invoiceDate),
      total_amount: Number(payload.totalAmount) || 0,
      paid_amount: Number(payload.paidAmount) || 0,
      status: payload.status || 'unpaid',
    };
  }
  if (col === 'purchases') {
    return {
      ...base,
      vendor_id: payload.vendorId || null,
      supplier_name: payload.supplierName || '',
      invoice_number: payload.invoiceNumber || '',
      bill_date: safeDate(payload.date),
      due_date: safeDate(payload.dueDate),
      total_amount: Number(payload.totalAmount) || 0,
      paid_amount: Number(payload.paidAmount) || 0,
      payment_status: payload.paymentStatus || 'Unpaid',
    };
  }
  if (col === 'purchase-orders') {
    return {
      ...base,
      vendor_id: payload.vendorId || null,
      po_number: payload.poNumber || '',
      po_date: safeDate(payload.date),
      total_amount: Number(payload.totalAmount) || 0,
    };
  }
  if (col === 'expenses') {
    return { ...base, expense_date: safeDate(payload.date), amount: Number(payload.amount) || 0 };
  }
  if (col === 'receipts') {
    return { ...base, receipt_date: safeDate(payload.date), amount: Number(payload.amount) || 0 };
  }
  return base;
}

export async function supabaseApiFetch(url, options = {}) {
  if (!isSupabaseConfigured() || !supabase) throw new Error('Supabase is not configured');
  const method = (options.method || 'GET').toUpperCase();
  const [pathname] = String(url).replace(/^\/api/, '').split('?');
  const body = options.body ? JSON.parse(options.body) : null;
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'check-update') return { current: '1.10.86', latest: '1.10.86', updateAvailable: false };
  if (parts[0] === 'version') return { current: '1.10.86' };
  if (parts[0] === 'lock' && parts[1] === 'status') return { enabled: false, unlocked: true };

  const companyId = await ensureActiveCompanyId();
  const userId = null;

  if (parts[0] === 'import' && method === 'POST') {
    return importBackupIntoSupabase(supabase, companyId, userId, body, toRow);
  }

  // Settings singletons: /profile, /local-prefs, /meta
  if (parts[0] === 'profile' || parts[0] === 'local-prefs' || parts[0] === 'meta') {
    const { data: row, error } = await supabase
      .from('app_settings')
      .select('profile, meta, local_prefs')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (parts[0] === 'profile') {
      if (method === 'POST') {
        const { error: upErr } = await supabase
          .from('app_settings')
          .upsert({ company_id: companyId, profile: body || {} }, { onConflict: 'company_id' });
        if (upErr) throw new Error(upErr.message);
        return { success: true };
      }
      return row?.profile || { businessName: '', gstin: '', address: '', state: '', country: 'India' };
    }

    if (parts[0] === 'local-prefs') {
      if (method === 'POST') {
        const next = { ...(row?.local_prefs || {}), ...(body || {}) };
        const { error: upErr } = await supabase
          .from('app_settings')
          .upsert({ company_id: companyId, local_prefs: next }, { onConflict: 'company_id' });
        if (upErr) throw new Error(upErr.message);
        return { success: true };
      }
      return row?.local_prefs || {};
    }

    // /meta
    const curMeta = row?.meta || {};
    if (parts.length === 1) {
      if (method === 'POST') {
        const next = { ...curMeta, ...(body || {}) };
        const { error: upErr } = await supabase
          .from('app_settings')
          .upsert({ company_id: companyId, meta: next }, { onConflict: 'company_id' });
        if (upErr) throw new Error(upErr.message);
        return { success: true };
      }
      return curMeta;
    }
    const key = decodeURIComponent(parts[1]);
    if (parts[2] === 'increment') {
      const { data: nextVal, error: rpcErr } = await supabase.rpc('increment_meta_counter', {
        p_company_id: companyId,
        p_key: key,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      return { value: nextVal };
    }
    if (method === 'POST') {
      const next = { ...curMeta, [key]: body?.value ?? body };
      const { error: upErr } = await supabase
        .from('app_settings')
        .upsert({ company_id: companyId, meta: next }, { onConflict: 'company_id' });
      if (upErr) throw new Error(upErr.message);
      return { success: true };
    }
    return { value: curMeta[key] ?? 0 };
  }

  // /vendors/:id/bank-details
  if (parts[0] === 'vendors' && parts[1] && parts[2] === 'bank-details') {
    const id = decodeURIComponent(parts[1]);
    const { data, error } = await supabase
      .from('vendors')
      .select('bank_details')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Vendor not found');
    const b = data.bank_details || {};
    return {
      accountHolderName: b.accountHolderName || '',
      bankName: b.bankName || '',
      accountNumber: b.accountNumber || '',
      routingCode: b.routingCode || '',
    };
  }

  // /products/price-update
  if (parts[0] === 'products' && parts[1] === 'price-update' && method === 'POST') {
    const { data: existing, error } = await supabase
      .from('products')
      .select('id, data')
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    const byId = new Map((existing || []).map((r) => [r.id, r.data]));
    const rows = [];
    for (const ch of body?.changes || []) {
      if (ch.id && byId.has(ch.id)) {
        rows.push(toRow('products', { ...byId.get(ch.id), ...ch }, companyId, userId));
      }
    }
    if (rows.length) {
      const { error: upErr } = await supabase.from('products').upsert(rows, { onConflict: 'company_id,id' });
      if (upErr) throw new Error(upErr.message);
    }
    return { success: true };
  }

  // Core relational tables
  const col = parts[0];
  if (CORE_TABLES.has(col)) {
    const tbl = tableNameFor(col);
    if (method === 'GET') {
      const { data, error } = await supabase
        .from(tbl)
        .select('data')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const list = (data || []).map((r) => r.data);
      return col === 'vendors' ? list.map(sanitiseVendor) : list;
    }
    if (method === 'POST') {
      const item = { ...(body || {}) };
      if (col === 'vendors' && item.id) {
        const { data: existing } = await supabase
          .from('vendors')
          .select('bank_details')
          .eq('company_id', companyId)
          .eq('id', item.id)
          .maybeSingle();
        const prevBank = existing?.bank_details || {};
        const inBank = item.bankDetails || {};
        item.bankDetails = {
          accountHolderName: inBank.accountHolderName || '',
          bankName: inBank.bankName || '',
          accountNumber: inBank.accountNumber && !String(inBank.accountNumber).includes('•') ? inBank.accountNumber : (prevBank.accountNumber || ''),
          routingCode: inBank.routingCode && !String(inBank.routingCode).includes('•') ? inBank.routingCode : (prevBank.routingCode || ''),
        };
      }
      const row = toRow(col, item, companyId, userId);
      const { error } = await supabase.from(tbl).upsert(row, { onConflict: 'company_id,id' });
      if (error) throw new Error(error.message);
      if (col === 'vendors') return { success: true, id: row.id, vendor: sanitiseVendor(row.data) };
      return { success: true, id: row.id };
    }
    if (method === 'DELETE' && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      const { error } = await supabase.from(tbl).delete().eq('company_id', companyId).eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true };
    }
  }

  // Secondary collections in company_documents
  if (DOC_COLLECTIONS.has(col)) {
    if (method === 'GET') {
      const { data, error } = await supabase
        .from('company_documents')
        .select('data')
        .eq('company_id', companyId)
        .eq('collection', col);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => r.data);
    }
    if (method === 'POST') {
      const item = { ...(body || {}) };
      const id = item.id || `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      item.id = id;
      const { error } = await supabase.from('company_documents').upsert(
        { company_id: companyId, collection: col, id, data: item, created_by: userId },
        { onConflict: 'company_id,collection,id' }
      );
      if (error) throw new Error(error.message);
      return { success: true, id };
    }
    if (method === 'DELETE' && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      const { error } = await supabase
        .from('company_documents')
        .delete()
        .eq('company_id', companyId)
        .eq('collection', col)
        .eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true };
    }
  }

  return {};
}

export function hasLocalBrowserData() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fgsb_browser_v1:')) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** One-time migration from browser localStorage (fgsb_browser_v1:*) into Supabase. */
export async function migrateLocalStorageToSupabase() {
  if (!supabase) throw new Error('Supabase is not configured');
  const companyId = await ensureActiveCompanyId();
  const userId = null;

  const readLocal = (key, fallback) => {
    let raw;
    try {
      raw = localStorage.getItem('fgsb_browser_v1:' + key);
    } catch (error) {
      throw new Error(`Could not read local browser data "${key}": ${error.message}`);
    }
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Could not parse local browser data "${key}": ${error.message}`);
    }
  };

  const readCollection = (col) => {
    const items = readLocal(`col:${col}`, []);
    if (!Array.isArray(items)) {
      throw new Error(`Could not migrate ${col}: local browser data must be a list`);
    }
    if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error(`Could not migrate ${col}: local browser data contains an invalid record`);
    }
    return items;
  };

  const summary = { settings: 0, records: 0 };
  const profile = readLocal('profile', null);
  const meta = readLocal('meta', null);
  const localPrefs = readLocal('local-prefs', null);
  if (profile || meta || localPrefs) {
    const { error } = await supabase.from('app_settings').upsert(
      {
        company_id: companyId,
        ...(profile ? { profile } : {}),
        ...(meta ? { meta } : {}),
        ...(localPrefs ? { local_prefs: localPrefs } : {}),
      },
      { onConflict: 'company_id' }
    );
    if (error) throw new Error(error.message);
    summary.settings = 1;
  }

  const dedupeById = (rows) => Array.from(new Map(rows.map((r) => [r.id, r])).values());
  const upsertBatched = async (table, rows, onConflict, label) => {
    const uniqueRows = dedupeById(rows);
    for (let i = 0; i < uniqueRows.length; i += 200) {
      const batch = uniqueRows.slice(i, i + 200);
      const { error } = await supabase.from(table).upsert(batch, { onConflict });
      if (error) throw new Error(`Failed migrating ${label}: ${error.message}`);
    }
    return uniqueRows.length;
  };

  for (const col of CORE_TABLES) {
    const items = readCollection(col);
    if (items.length === 0) continue;
    let rows = items.map((it) => toRow(col, it, companyId, userId));

    if (col === 'bills') {
      const { data: clientRows, error } = await supabase.from('clients').select('id').eq('company_id', companyId);
      if (error) throw new Error(`Failed checking client references: ${error.message}`);
      const validClientIds = new Set((clientRows || []).map((c) => c.id));
      rows = rows.map((r) => (r.client_id && !validClientIds.has(r.client_id) ? { ...r, client_id: null } : r));
    }
    if (col === 'purchases' || col === 'purchase-orders') {
      const { data: vendorRows, error } = await supabase.from('vendors').select('id').eq('company_id', companyId);
      if (error) throw new Error(`Failed checking vendor references: ${error.message}`);
      const validVendorIds = new Set((vendorRows || []).map((v) => v.id));
      rows = rows.map((r) => (r.vendor_id && !validVendorIds.has(r.vendor_id) ? { ...r, vendor_id: null } : r));
    }

    summary.records += await upsertBatched(tableNameFor(col), rows, 'company_id,id', col);
  }

  for (const col of DOC_COLLECTIONS) {
    const items = readCollection(col);
    if (items.length === 0) continue;
    const rows = items.map((it) => {
      const id = String(it.id || `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      return { company_id: companyId, collection: col, id, data: { ...it, id }, created_by: userId };
    });
    summary.records += await upsertBatched('company_documents', rows, 'company_id,collection,id', col);
  }

  // Clear legacy browser localStorage data once migrated to cloud
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fgsb_browser_v1:')) keysToRemove.push(k);
    }
    for (const k of keysToRemove) localStorage.removeItem(k);
  } catch { /* ignore */ }

  return summary;
}
