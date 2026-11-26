import { supabase, isSupabaseConfigured } from './supabaseClient';

let cachedCompanyId = null;
let cachedUserId = null;

export function clearSupabaseSessionCache() {
  cachedCompanyId = null;
  cachedUserId = null;
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
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error('Please sign in to continue');

  if (cachedCompanyId && cachedUserId === user.id) return cachedCompanyId;

  const { data: memberships, error: memErr } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1);
  if (memErr) throw new Error(memErr.message);

  if (memberships && memberships.length > 0) {
    cachedCompanyId = memberships[0].company_id;
    cachedUserId = user.id;
    return cachedCompanyId;
  }

  const { data: bootstrappedId, error: bootErr } = await supabase.rpc('bootstrap_company', {
    p_name: user.email ? `${user.email.split('@')[0]}'s Company` : 'My Company',
  });
  if (bootErr) throw new Error(bootErr.message);
  cachedCompanyId = bootstrappedId;
  cachedUserId = user.id;
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

function toRow(col, item, companyId, userId) {
  const id = item.id || `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
      payment_terms_days: payload.paymentTermsDays === '' || payload.paymentTermsDays == null ? null : Number(payload.paymentTermsDays),
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
      invoice_date: payload.invoiceDate || null,
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
      bill_date: payload.date || null,
      due_date: payload.dueDate || null,
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
      po_date: payload.date || null,
      total_amount: Number(payload.totalAmount) || 0,
    };
  }
  if (col === 'expenses') {
    return { ...base, expense_date: payload.date || null, amount: Number(payload.amount) || 0 };
  }
  if (col === 'receipts') {
    return { ...base, receipt_date: payload.date || null, amount: Number(payload.amount) || 0 };
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
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || null;

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
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || null;

  const readLocal = (key, fallback) => {
    try {
      const raw = localStorage.getItem('fgsb_browser_v1:' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
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

  for (const col of CORE_TABLES) {
    const items = readLocal(`col:${col}`, []);
    if (!Array.isArray(items) || items.length === 0) continue;
    const rows = items.map((it) => toRow(col, it, companyId, userId));
    const { error } = await supabase.from(tableNameFor(col)).upsert(rows, { onConflict: 'company_id,id' });
    if (error) throw new Error(`Failed migrating ${col}: ${error.message}`);
    summary.records += rows.length;
  }

  for (const col of DOC_COLLECTIONS) {
    const items = readLocal(`col:${col}`, []);
    if (!Array.isArray(items) || items.length === 0) continue;
    const rows = items.map((it) => {
      const id = it.id || `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      return { company_id: companyId, collection: col, id, data: { ...it, id }, created_by: userId };
    });
    const { error } = await supabase.from('company_documents').upsert(rows, { onConflict: 'company_id,collection,id' });
    if (error) throw new Error(`Failed migrating ${col}: ${error.message}`);
    summary.records += rows.length;
  }

  return summary;
}
