import { useState, useEffect, useMemo } from 'react';
import {
  Building2, Search, ChevronDown, ChevronUp, Trash2, X, Plus, Edit3,
  Eye, EyeOff, AlertTriangle, ShoppingCart, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  getAllVendors, saveVendor, deleteVendor, revealVendorBankDetails,
  getAllPurchases, getProfile,
} from '../store';
import { formatCurrency, localToday, calculateRoundOff, belongsToProfile } from '../utils';
import { confirmAction } from './ConfirmModal';
import { toast } from './Toast';
import VendorModal from './VendorModal';

const STATUS_BADGE = {
  Paid: { color: '#059669', bg: '#ecfdf5', label: 'Paid' },
  Partial: { color: '#8b5cf6', bg: '#f5f3ff', label: 'Partial' },
  Unpaid: { color: '#f59e0b', bg: '#fffbeb', label: 'Unpaid' },
};

const PAGE_SIZE = 10;

function purchaseTotal(p) {
  if (typeof p.totalAmount === 'number' && !Number.isNaN(p.totalAmount)) return p.totalAmount;
  const raw = (p.items || []).reduce((acc, item) => {
    const amt = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
    const tax = (amt * (Number(item.taxPercent) || 0)) / 100;
    const cess = (amt * (Number(item.cessPercent) || 0)) / 100;
    return acc + amt + tax + cess;
  }, 0);
  return p.applyRoundOff ? raw + calculateRoundOff(raw) : raw;
}

function unpaidBalance(p) {
  const status = p.paymentStatus || 'Unpaid';
  if (status === 'Paid') return 0;
  const total = purchaseTotal(p);
  const paid = Math.max(0, Number(p.paidAmount) || 0);
  return Math.max(0, total - paid);
}

function isPurchaseOverdue(p, todayStr) {
  const bal = unpaidBalance(p);
  if (bal <= 0.01) return false;
  if (!p.dueDate) return false;
  return p.dueDate < todayStr;
}

export default function VendorsView({ onOpenPurchases, embedded = false }) {
  const [vendors, setVendors] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalVendor, setModalVendor] = useState(null);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [profileCountry, setProfileCountry] = useState('');
  const [revealedBankById, setRevealedBankById] = useState({});
  const [historyPageByKey, setHistoryPageByKey] = useState({});

  const todayStr = localToday();

  useEffect(() => {
    getProfile()
      .then((p) => {
        if (p?.country) setProfileCountry(p.country);
      })
      .catch(() => {});
  }, []);

  const loadData = async () => {
    try {
      const [v, p, prof] = await Promise.all([
        getAllVendors(),
        getAllPurchases(),
        getProfile().catch(() => null),
      ]);
      setVendors(v || []);
      setPurchases((p || []).filter((r) => belongsToProfile(r, prof)));
    } catch {
      toast('Failed to load vendors', 'error');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Index saved vendors by id and lowercase name
  const savedVendorByKey = useMemo(() => {
    const map = new Map();
    for (const v of vendors) {
      if (v.name) map.set(v.name.trim().toLowerCase(), v);
    }
    return map;
  }, [vendors]);

  // Group all purchase bills by vendor (matching vendorId first, then supplierName)
  const billsByKey = useMemo(() => {
    const byId = new Map(vendors.map((v) => [v.id, (v.name || '').trim().toLowerCase()]));
    const map = new Map();
    for (const p of purchases) {
      const idKey = p.vendorId && byId.get(p.vendorId);
      const nameKey = (p.supplierName || '').trim().toLowerCase();
      const key = idKey || nameKey;
      if (!key) continue;
      let arr = map.get(key);
      if (!arr) {
        arr = [];
        map.set(key, arr);
      }
      arr.push(p);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    return map;
  }, [purchases, vendors]);

  // Combine saved vendors + any suppliers from purchase bills not yet onboarded
  const allVendorEntries = useMemo(() => {
    const entries = new Map();
    for (const v of vendors) {
      const key = (v.name || '').trim().toLowerCase();
      if (!key) continue;
      entries.set(key, { key, name: v.name, saved: v });
    }
    for (const [key, bills] of billsByKey.entries()) {
      if (!entries.has(key)) {
        const latest = bills[0];
        entries.set(key, {
          key,
          name: latest.supplierName || key,
          saved: null,
          inferredGstin: latest.supplierGstin || '',
          inferredAddress: latest.supplierAddress || '',
        });
      }
    }
    return [...entries.values()];
  }, [vendors, billsByKey]);

  const statsByKey = useMemo(() => {
    const map = new Map();
    for (const entry of allVendorEntries) {
      const vBills = billsByKey.get(entry.key) || [];
      let totalPurchased = 0;
      let totalPaid = 0;
      let overdueAmount = 0;
      let overdueCount = 0;
      for (const b of vBills) {
        const tot = purchaseTotal(b);
        const bal = unpaidBalance(b);
        totalPurchased += tot;
        totalPaid += Math.max(0, tot - bal);
        if (isPurchaseOverdue(b, todayStr)) {
          overdueAmount += bal;
          overdueCount++;
        }
      }
      map.set(entry.key, {
        count: vBills.length,
        totalPurchased,
        totalPaid,
        overdueAmount,
        overdueCount,
      });
    }
    return map;
  }, [allVendorEntries, billsByKey, todayStr]);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? allVendorEntries.filter((e) => {
          const v = e.saved;
          return (
            e.name.toLowerCase().includes(q) ||
            (v?.contactPerson || '').toLowerCase().includes(q) ||
            (v?.gstin || e.inferredGstin || '').toLowerCase().includes(q)
          );
        })
      : allVendorEntries;
    return [...list].sort((a, b) => {
      const sa = statsByKey.get(a.key) || { overdueAmount: 0, totalPurchased: 0 };
      const sb = statsByKey.get(b.key) || { overdueAmount: 0, totalPurchased: 0 };
      if (sb.overdueAmount !== sa.overdueAmount) return sb.overdueAmount - sa.overdueAmount;
      return a.name.localeCompare(b.name);
    });
  }, [allVendorEntries, search, statsByKey]);

  const summaryTotals = useMemo(() => {
    let totalOverdue = 0;
    let totalPurchased = 0;
    let overdueVendors = 0;
    for (const s of statsByKey.values()) {
      totalPurchased += s.totalPurchased;
      totalOverdue += s.overdueAmount;
      if (s.overdueAmount > 0.01) overdueVendors++;
    }
    return { totalVendors: vendors.length, totalPurchased, totalOverdue, overdueVendors };
  }, [statsByKey, vendors.length]);

  const openAddVendor = (prefill = null) => {
    setModalVendor(prefill);
    setEditingVendorId(null);
    setShowModal(true);
  };

  const openEditVendor = (vendor) => {
    setModalVendor(vendor);
    setEditingVendorId(vendor.id);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalVendor(null);
    setEditingVendorId(null);
  };

  const handleSaveVendor = async (formData) => {
    try {
      const payload = { ...formData };
      if (editingVendorId) payload.id = editingVendorId;
      await saveVendor(payload);
      toast(editingVendorId ? 'Vendor updated' : 'Vendor onboarded', 'success');
      closeModal();
      setRevealedBankById({});
      loadData();
    } catch (err) {
      toast(err?.message || 'Failed to save vendor', 'error');
    }
  };

  const handleDeleteVendor = async (id) => {
    if (
      await confirmAction({
        title: 'Remove this vendor?',
        message: 'Existing purchase bills stay untouched — this only removes the vendor profile.',
        confirmLabel: 'Remove',
        tone: 'danger',
      })
    ) {
      await deleteVendor(id);
      toast('Vendor removed', 'success');
      loadData();
    }
  };

  const toggleRevealBank = async (vendorId) => {
    if (revealedBankById[vendorId]) {
      setRevealedBankById((prev) => {
        const copy = { ...prev };
        delete copy[vendorId];
        return copy;
      });
      return;
    }
    try {
      const details = await revealVendorBankDetails(vendorId);
      setRevealedBankById((prev) => ({ ...prev, [vendorId]: details }));
    } catch {
      toast('Failed to reveal bank details', 'error');
    }
  };

  return (
    <div className={embedded ? '' : 'dashboard-container'}>
      {embedded ? (
        <div className="flex gap-2 justify-end mb-4">
          {onOpenPurchases && (
            <button className="btn btn-secondary" onClick={onOpenPurchases}>
              <ShoppingCart size={16} /> Purchase Bills
            </button>
          )}
          <button className="btn btn-primary" onClick={() => openAddVendor()}>
            <Plus size={18} /> Add Vendor
          </button>
        </div>
      ) : (
        <div className="page-header">
          <div>
            <h1 className="page-title">Vendors &amp; Suppliers</h1>
            <p className="page-subtitle">Vendor onboarding, overdue payables, and purchase bill history</p>
          </div>
          <div className="flex gap-2">
            {onOpenPurchases && (
              <button className="btn btn-secondary" onClick={onOpenPurchases}>
                <ShoppingCart size={16} /> Purchase Bills
              </button>
            )}
            <button className="btn btn-primary" onClick={() => openAddVendor()}>
              <Plus size={18} /> Add Vendor
            </button>
          </div>
        </div>
      )}

      <VendorModal
        show={showModal}
        onClose={closeModal}
        onSave={handleSaveVendor}
        vendor={modalVendor}
        isEditing={!!editingVendorId}
        defaultCountry={profileCountry}
      />

      {/* Summary Cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon stat-icon-purple">
            <Building2 size={22} />
          </div>
          <div>
            <p className="stat-label">Onboarded Vendors</p>
            <h2 className="stat-value stat-value-purple">{summaryTotals.totalVendors}</h2>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">
            <ShoppingCart size={22} />
          </div>
          <div>
            <p className="stat-label">Total Purchases</p>
            <h2 className="stat-value">{formatCurrency(summaryTotals.totalPurchased)}</h2>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <p className="stat-label">Total Overdue ({summaryTotals.overdueVendors} vendors)</p>
            <h2 className="stat-value" style={{ color: summaryTotals.totalOverdue > 0 ? '#dc2626' : '#059669' }}>
              {formatCurrency(summaryTotals.totalOverdue)}
            </h2>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="glass-panel p-4 mb-6">
        <div className="search-box" style={{ maxWidth: '400px' }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search vendors by name, contact, or tax ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          {search && (
            <button className="icon-btn" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Vendor List */}
      {filteredVendors.length === 0 ? (
        <div className="glass-panel p-6">
          <div className="empty-state">
            <Building2 size={48} />
            <p>No vendors found.</p>
            <button className="btn btn-secondary" onClick={() => openAddVendor()} style={{ marginTop: '0.5rem' }}>
              <Plus size={16} /> Onboard Your First Vendor
            </button>
          </div>
        </div>
      ) : (
        <div className="client-list">
          {filteredVendors.map((entry) => {
            const v = entry.saved || savedVendorByKey.get(entry.key);
            const stats = statsByKey.get(entry.key) || {
              count: 0,
              totalPurchased: 0,
              totalPaid: 0,
              overdueAmount: 0,
              overdueCount: 0,
            };
            const isExpanded = expandedKey === entry.key;
            const vBills = isExpanded ? billsByKey.get(entry.key) || [] : [];
            const page = historyPageByKey[entry.key] || 1;
            const totalPages = Math.max(1, Math.ceil(vBills.length / PAGE_SIZE));
            const safePage = Math.min(page, totalPages);
            const pagedBills = vBills.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
            const revealedBank = v?.id ? revealedBankById[v.id] : null;
            const bank = v?.bankDetails || {};

            return (
              <div key={entry.key} className="glass-panel mb-4" style={{ overflow: 'hidden' }}>
                <div
                  className="client-card-header"
                  onClick={() => setExpandedKey(isExpanded ? null : entry.key)}
                >
                  <div className="client-card-info">
                    <div className="client-avatar">{entry.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <h3 className="client-card-name">
                        {entry.name}
                        {!v && (
                          <span
                            style={{
                              marginLeft: '0.5rem',
                              fontSize: '0.68rem',
                              background: '#fef3c7',
                              color: '#92400e',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontWeight: 600,
                            }}
                          >
                            Not onboarded
                          </span>
                        )}
                      </h3>
                      <p className="client-card-meta">
                        {stats.count} bill{stats.count !== 1 ? 's' : ''}
                        {v?.contactPerson ? ` | ${v.contactPerson}` : ''}
                        {(v?.state || '') ? ` | ${v.state}` : ''}
                        {(v?.gstin || entry.inferredGstin) ? ` | ${v?.gstin || entry.inferredGstin}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="client-card-stats">
                    <div className="client-stat">
                      <span className="client-stat-label">Total Purchased</span>
                      <span className="client-stat-value">{formatCurrency(stats.totalPurchased)}</span>
                    </div>
                    <div className="client-stat">
                      <span className="client-stat-label">Paid</span>
                      <span className="client-stat-value" style={{ color: '#059669' }}>
                        {formatCurrency(stats.totalPaid)}
                      </span>
                    </div>
                    <div className="client-stat">
                      <span className="client-stat-label">
                        Overdue{stats.overdueCount > 0 ? ` (${stats.overdueCount})` : ''}
                      </span>
                      <span
                        className="client-stat-value"
                        style={{ color: stats.overdueAmount > 0.01 ? '#dc2626' : '#059669' }}
                      >
                        {formatCurrency(stats.overdueAmount)}
                      </span>
                    </div>
                    <div
                      style={{
                        marginLeft: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {isExpanded ? 'Hide' : 'View'} {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="client-invoices">
                    {/* Vendor Profile + Masked Bank Details + Actions */}
                    <div
                      style={{
                        padding: '0.75rem 1.5rem',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        fontSize: '0.82rem',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'var(--text-muted)' }}>
                        {v ? (
                          <>
                            <div>
                              {[v.address, v.city, v.state, v.pin, v.country].filter(Boolean).join(', ') || 'No address saved'}
                              {v.email ? `  ·  ${v.email}` : ''}
                              {v.phone ? `  ·  ${v.phone}` : ''}
                            </div>
                            {(bank.bankName || bank.hasAccountNumber || bank.hasRoutingCode) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span>
                                  <strong>Bank:</strong> {bank.bankName || '—'}
                                  {bank.accountHolderName ? ` (${bank.accountHolderName})` : ''}
                                  {' · '}Acct:{' '}
                                  <code>
                                    {revealedBank
                                      ? revealedBank.accountNumber || '—'
                                      : bank.accountNumberMasked || '—'}
                                  </code>
                                  {' · '}Code:{' '}
                                  <code>
                                    {revealedBank
                                      ? revealedBank.routingCode || '—'
                                      : bank.routingCodeMasked || '—'}
                                  </code>
                                </span>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => toggleRevealBank(v.id)}
                                  title={revealedBank ? 'Hide bank details' : 'Reveal bank details'}
                                  style={{ fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                >
                                  {revealedBank ? <EyeOff size={13} /> : <Eye size={13} />}
                                  {revealedBank ? 'Hide' : 'Show'}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <span>Supplier derived from purchase bills. Onboard to store contact &amp; bank details.</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {v ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}
                              onClick={() => openEditVendor(v)}
                            >
                              <Edit3 size={14} /> Edit Vendor
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-red"
                              onClick={() => handleDeleteVendor(v.id)}
                              title="Remove vendor"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                            onClick={() =>
                              openAddVendor({
                                name: entry.name,
                                gstin: entry.inferredGstin || '',
                                address: entry.inferredAddress || '',
                              })
                            }
                          >
                            <Plus size={14} /> Onboard Vendor
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Purchase History Table */}
                    {vBills.length === 0 ? (
                      <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                          No purchase bills recorded for this vendor yet.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="table-scroll" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                          <table className="data-table" style={{ marginBottom: 0 }}>
                            <thead>
                              <tr>
                                <th>Bill Date</th>
                                <th>Bill Number</th>
                                <th>Due Date</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th style={{ textAlign: 'right' }}>Balance Due</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedBills.map((b) => {
                                const tot = purchaseTotal(b);
                                const bal = unpaidBalance(b);
                                const overdue = isPurchaseOverdue(b, todayStr);
                                const st = STATUS_BADGE[b.paymentStatus || 'Unpaid'] || STATUS_BADGE.Unpaid;
                                return (
                                  <tr key={b.id}>
                                    <td className="text-muted">
                                      {b.date ? new Date(b.date).toLocaleDateString('en-IN') : '—'}
                                    </td>
                                    <td>
                                      <span className="invoice-badge">{b.invoiceNumber || '—'}</span>
                                    </td>
                                    <td>
                                      {b.dueDate ? (
                                        <span style={{ color: overdue ? '#dc2626' : 'var(--text-muted)', fontWeight: overdue ? 600 : 400 }}>
                                          {new Date(b.dueDate).toLocaleDateString('en-IN')}
                                          {overdue && (
                                            <span
                                              style={{
                                                marginLeft: '0.4rem',
                                                fontSize: '0.68rem',
                                                background: '#fef2f2',
                                                color: '#dc2626',
                                                padding: '1px 5px',
                                                borderRadius: 4,
                                              }}
                                            >
                                              OVERDUE
                                            </span>
                                          )}
                                        </span>
                                      ) : (
                                        <span className="text-muted">—</span>
                                      )}
                                    </td>
                                    <td style={{ textAlign: 'right' }} className="font-bold">
                                      {formatCurrency(tot)}
                                    </td>
                                    <td
                                      style={{
                                        textAlign: 'right',
                                        color: overdue ? '#dc2626' : bal > 0.01 ? '#d97706' : '#059669',
                                      }}
                                    >
                                      {formatCurrency(bal)}
                                    </td>
                                    <td>
                                      <span
                                        style={{
                                          background: st.bg,
                                          color: st.color,
                                          padding: '2px 8px',
                                          borderRadius: 999,
                                          fontSize: '0.75rem',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {st.label}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {vBills.length > PAGE_SIZE && (
                          <div
                            style={{
                              padding: '0.6rem 1.5rem',
                              borderTop: '1px solid var(--border)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '0.78rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <span>
                              Showing {(safePage - 1) * PAGE_SIZE + 1}–
                              {Math.min(safePage * PAGE_SIZE, vBills.length)} of {vBills.length} bills
                            </span>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                disabled={safePage <= 1}
                                onClick={() =>
                                  setHistoryPageByKey((prev) => ({ ...prev, [entry.key]: safePage - 1 }))
                                }
                              >
                                <ChevronLeft size={14} /> Prev
                              </button>
                              <span>
                                Page {safePage} / {totalPages}
                              </span>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                disabled={safePage >= totalPages}
                                onClick={() =>
                                  setHistoryPageByKey((prev) => ({ ...prev, [entry.key]: safePage + 1 }))
                                }
                              >
                                Next <ChevronRight size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
