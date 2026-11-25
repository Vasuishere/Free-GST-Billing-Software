// Browser-only localStorage fallback for static deployments (e.g. Vercel)
// where the local Express server (server.js) is not running.

const PREFIX = 'fgsb_browser_v1:';
let browserMode = false;

export function isLocalhostOrigin() {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

export function isBrowserMode() {
  return browserMode;
}

export function enableBrowserMode() {
  browserMode = true;
}

function readKey(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
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

const COLLECTIONS = new Set([
  'bills', 'clients', 'vendors', 'templates', 'products', 'expenses',
  'recurring', 'receipts', 'profiles', 'purchases', 'productions',
  'purchase-orders', 'cash-book', 'debit-notes', 'bank-statements', 'stock-adjustments',
]);

export async function browserApiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const [pathname, queryStr] = String(url).replace(/^\/api/, '').split('?');
  const params = new URLSearchParams(queryStr || '');
  const body = options.body ? JSON.parse(options.body) : null;
  const parts = pathname.split('/').filter(Boolean);

  // /profile
  if (parts[0] === 'profile') {
    if (method === 'POST') {
      writeKey('profile', body || {});
      return { success: true };
    }
    return readKey('profile', { businessName: '', gstin: '', address: '', state: '', country: 'India' });
  }

  // /local-prefs
  if (parts[0] === 'local-prefs') {
    if (method === 'POST') {
      const cur = readKey('local-prefs', {});
      writeKey('local-prefs', { ...cur, ...(body || {}) });
      return { success: true };
    }
    return readKey('local-prefs', {});
  }

  // /lock/status
  if (parts[0] === 'lock' && parts[1] === 'status') {
    return { enabled: false, unlocked: true };
  }

  // /check-update, /version
  if (parts[0] === 'check-update') return { current: '1.10.86', latest: '1.10.86', updateAvailable: false };
  if (parts[0] === 'version') return { current: '1.10.86' };

  // /meta/:key(/increment)
  if (parts[0] === 'meta') {
    const meta = readKey('meta', {});
    if (parts.length === 1) {
      if (method === 'POST') {
        const next = { ...meta, ...(body || {}) };
        writeKey('meta', next);
        return { success: true };
      }
      return meta;
    }
    const key = decodeURIComponent(parts[1]);
    if (parts[2] === 'increment') {
      const nextVal = (Number(meta[key]) || 0) + 1;
      meta[key] = nextVal;
      writeKey('meta', meta);
      return { value: nextVal };
    }
    if (method === 'POST') {
      meta[key] = body?.value ?? body;
      writeKey('meta', meta);
      return { success: true };
    }
    return { value: meta[key] ?? 0 };
  }

  // /vendors/:id/bank-details
  if (parts[0] === 'vendors' && parts[1] && parts[2] === 'bank-details') {
    const list = readKey('col:vendors', []);
    const found = list.find((v) => v.id === decodeURIComponent(parts[1]));
    if (!found) throw new Error('Vendor not found');
    const b = found.bankDetails || {};
    return {
      accountHolderName: b.accountHolderName || '',
      bankName: b.bankName || '',
      accountNumber: b.accountNumber || '',
      routingCode: b.routingCode || '',
    };
  }

  // /products/price-update
  if (parts[0] === 'products' && parts[1] === 'price-update' && method === 'POST') {
    const list = readKey('col:products', []);
    const byId = new Map(list.map((p) => [p.id, p]));
    for (const ch of body?.changes || []) {
      if (ch.id && byId.has(ch.id)) byId.set(ch.id, { ...byId.get(ch.id), ...ch });
    }
    writeKey('col:products', [...byId.values()]);
    return { success: true };
  }

  // /export & /import
  if (parts[0] === 'export') {
    const out = { profile: readKey('profile', {}), meta: readKey('meta', {}), exportedAt: new Date().toISOString() };
    for (const c of COLLECTIONS) out[c === 'templates' ? 'termsTemplates' : c] = readKey(`col:${c}`, []);
    return out;
  }
  if (parts[0] === 'import' && method === 'POST') {
    if (body?.profile) writeKey('profile', body.profile);
    if (body?.meta) writeKey('meta', body.meta);
    for (const c of COLLECTIONS) {
      const src = c === 'templates' ? body?.termsTemplates : body?.[c];
      if (Array.isArray(src)) writeKey(`col:${c}`, src);
    }
    return { success: true };
  }

  // Generic collection CRUD: /:col(/:id)
  const col = parts[0];
  if (COLLECTIONS.has(col)) {
    const list = readKey(`col:${col}`, []);
    if (method === 'GET') {
      if (col === 'vendors') return list.map(sanitiseVendor);
      return list;
    }
    if (method === 'POST') {
      const item = { ...(body || {}) };
      if (!item.id) item.id = `${col.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const idx = list.findIndex((x) => x.id === item.id);
      if (col === 'bills' && idx >= 0 && params.get('overwrite') !== '1' && params.get('overwrite') !== 'true') {
        // Allow normal saves
      }
      if (col === 'vendors' && idx >= 0) {
        const prevBank = list[idx].bankDetails || {};
        const inBank = item.bankDetails || {};
        item.bankDetails = {
          accountHolderName: inBank.accountHolderName || '',
          bankName: inBank.bankName || '',
          accountNumber: inBank.accountNumber && !String(inBank.accountNumber).includes('•') ? inBank.accountNumber : (prevBank.accountNumber || ''),
          routingCode: inBank.routingCode && !String(inBank.routingCode).includes('•') ? inBank.routingCode : (prevBank.routingCode || ''),
        };
      }
      if (idx >= 0) list[idx] = item;
      else list.unshift(item);
      writeKey(`col:${col}`, list);
      if (col === 'vendors') return { success: true, id: item.id, vendor: sanitiseVendor(item) };
      return { success: true, id: item.id };
    }
    if (method === 'DELETE' && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      writeKey(`col:${col}`, list.filter((x) => x.id !== id));
      return { success: true };
    }
  }

  return {};
}
