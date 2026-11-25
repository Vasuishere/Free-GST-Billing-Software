import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Star } from 'lucide-react';
import {
  getCountryConfig,
  getStatesForCountry,
  validateTaxId,
  detectCountryFromBrowser,
  getCountriesForRegion,
  PAPER_SIZES,
  decodeGstin,
  COUNTRIES,
  localToday,
} from '../utils';
import { fyStartDate, openingFields } from '../utils/clientLedger';
import { getRegionMode, activePriceLevels } from '../store';
import { PriceLevelSelect } from './PriceLevelFields';
import HelpButton from './HelpButton';

const makeAddrId = () => 'addr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

const emptyAddress = (country) => ({
  address: '',
  city: '',
  pin: '',
  state: '',
  country: country || 'India',
});

const emptyShipping = (country) => ({
  id: makeAddrId(),
  label: '',
  ...emptyAddress(country),
  isDefault: false,
});

/** Normalise a legacy (flat) or v2 client object into the modal form state. */
function normaliseClient(client, fallbackCountry) {
  const defaultOpeningDate = fyStartDate(localToday());
  if (client?.billingAddress) {
    const shipping = (client.shippingAddresses || []).map((a) => ({
      ...emptyShipping(fallbackCountry),
      ...a,
    }));
    return {
      name: client.name || '',
      gstin: client.gstin || '',
      email: client.email || '',
      phone: client.phone || '',
      isSEZ: !!client.isSEZ,
      isDeemedExport: !!client.isDeemedExport,
      preferredPaperSize: client.preferredPaperSize || '',
      preferredCurrency: client.preferredCurrency || '',
      autoPrint: !!client.autoPrint,
      creditLimit: client.creditLimit || '',
      priceLevel: client.priceLevel || '',
      openingBalance: client.openingBalance || '',
      openingBalanceDate: client.openingBalanceDate || defaultOpeningDate,
      openingBalanceType: client.openingBalanceType === 'advance' ? 'advance' : 'receivable',
      openingBalanceBusiness: client.openingBalanceBusiness || '',
      billingAddress: { ...emptyAddress(fallbackCountry), ...client.billingAddress },
      shippingAddresses: shipping,
      sameAsBilling: shipping.length === 0,
    };
  }
  return {
    name: client?.name || '',
    gstin: client?.gstin || '',
    email: client?.email || '',
    phone: client?.phone || '',
    isSEZ: !!client?.isSEZ,
    isDeemedExport: !!client?.isDeemedExport,
    preferredPaperSize: client?.preferredPaperSize || '',
    preferredCurrency: client?.preferredCurrency || '',
    autoPrint: !!client?.autoPrint,
    creditLimit: client?.creditLimit || '',
    priceLevel: client?.priceLevel || '',
    openingBalance: client?.openingBalance || '',
    openingBalanceDate: client?.openingBalanceDate || defaultOpeningDate,
    openingBalanceType: client?.openingBalanceType === 'advance' ? 'advance' : 'receivable',
    openingBalanceBusiness: client?.openingBalanceBusiness || '',
    billingAddress: {
      address: client?.address || '',
      city: client?.city || '',
      pin: client?.pin || '',
      state: client?.state || '',
      country: client?.country || fallbackCountry,
    },
    shippingAddresses: [],
    sameAsBilling: true,
  };
}

/** Reusable address field group for both billing and shipping addresses. */
function AddressFields({ addr, onChange, countryConfig, stateOptions, label }) {
  const cc = countryConfig;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="form-group" style={{ gridColumn: 'span 2' }}>
        <label className="form-label">{label || 'Street Address'}</label>
        <input
          type="text"
          className="form-input"
          value={addr.address}
          onChange={(e) => onChange({ ...addr, address: e.target.value })}
          placeholder="Street address, locality"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Country</label>
        <select
          className="form-input"
          value={addr.country}
          onChange={(e) => onChange({ ...addr, country: e.target.value, state: '' })}
        >
          {(() => {
            const visible = getCountriesForRegion(getRegionMode());
            const out = [];
            if (addr.country && !visible.some((c) => c.name === addr.country)) {
              out.push(
                <option key={addr.country} value={addr.country}>
                  {addr.country}
                </option>
              );
            }
            return out.concat(
              visible.map((c) => (
                <option key={c.code} value={c.name}>
                  {c.name}
                </option>
              ))
            );
          })()}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">City</label>
        <input
          type="text"
          className="form-input"
          value={addr.city}
          onChange={(e) => onChange({ ...addr, city: e.target.value })}
          placeholder="e.g. Mumbai"
        />
      </div>
      <div className="form-group">
        <label className="form-label">{cc.postalLabel}</label>
        <input
          type="text"
          className="form-input"
          value={addr.pin}
          onChange={(e) => onChange({ ...addr, pin: e.target.value })}
          placeholder={cc.postalLabel}
        />
      </div>
      <div className="form-group">
        <label className="form-label">{cc.stateLabel}</label>
        {stateOptions.length > 0 ? (
          <select
            className="form-input"
            value={addr.state}
            onChange={(e) => onChange({ ...addr, state: e.target.value })}
          >
            <option value="">Select {cc.stateLabel}</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="form-input"
            value={addr.state}
            onChange={(e) => onChange({ ...addr, state: e.target.value })}
            placeholder={cc.stateLabel}
          />
        )}
      </div>
    </div>
  );
}

// v1.10.86 (#214) - businessKey: the business an opening balance typed here is with.
export default function ClientModal({ show, onClose, onSave, client, isEditing, defaultCountry, businessKey = '' }) {
  // Country defaults: explicit prop (active business profile) -> browser locale -> 'India'.
  const fallbackCountry = defaultCountry || detectCountryFromBrowser();
  const [form, setForm] = useState(() => normaliseClient(null, fallbackCountry));
  const [taxIdWarning, setTaxIdWarning] = useState('');

  useEffect(() => {
    if (show && client) {
      setForm(normaliseClient(client, fallbackCountry));
    } else if (show) {
      setForm(normaliseClient(null, fallbackCountry));
    }
    setTaxIdWarning('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, client]);

  if (!show) return null;

  const billingCc = getCountryConfig(form.billingAddress.country);
  const billingStates = getStatesForCountry(form.billingAddress.country);
  const abroad = !!form.billingAddress.country && form.billingAddress.country !== (defaultCountry || 'India');
  const currencyCodes = [...new Set(COUNTRIES.map((c) => c.currency))];
  const levels = activePriceLevels();

  const handleTaxIdBlur = () => {
    const result = validateTaxId(form.billingAddress.country, form.gstin);
    setTaxIdWarning(result.ok ? '' : result.message);
    if (form.billingAddress.country !== 'India') return;
    const decoded = decodeGstin(form.gstin);
    if (!decoded) return;
    if (!decoded.checksumOk) {
      setTaxIdWarning('This GSTIN fails its own checksum — check for a typo.');
      return;
    }
    if (!decoded.state) return;
    if (!form.billingAddress.state?.trim()) {
      setForm((prev) => ({
        ...prev,
        billingAddress: { ...prev.billingAddress, state: decoded.state },
      }));
    } else if (form.billingAddress.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setTaxIdWarning(
        `This GSTIN is registered in ${decoded.state}, but the state says ${form.billingAddress.state}.`
      );
    }
  };

  const addShipping = () => {
    setForm((prev) => {
      const isFirst = prev.shippingAddresses.length === 0;
      return {
        ...prev,
        shippingAddresses: [
          ...prev.shippingAddresses,
          { ...emptyShipping(prev.billingAddress.country), isDefault: isFirst },
        ],
        sameAsBilling: false,
      };
    });
  };

  const updateShipping = (idx, updated) => {
    setForm((prev) => ({
      ...prev,
      shippingAddresses: prev.shippingAddresses.map((a, i) => (i === idx ? updated : a)),
    }));
  };

  const removeShipping = (idx) => {
    setForm((prev) => {
      const next = prev.shippingAddresses.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((a) => a.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      return { ...prev, shippingAddresses: next, sameAsBilling: next.length === 0 };
    });
  };

  const setDefaultShipping = (idx) => {
    setForm((prev) => ({
      ...prev,
      shippingAddresses: prev.shippingAddresses.map((a, i) => ({
        ...a,
        isDefault: i === idx,
      })),
    }));
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const shippingList = form.sameAsBilling ? [] : form.shippingAddresses;
    if (shippingList.length > 0 && !shippingList.some((a) => a.isDefault)) {
      shippingList[0] = { ...shippingList[0], isDefault: true };
    }
    const limit = Number(form.creditLimit);
    onSave({
      name: form.name,
      gstin: form.gstin,
      email: form.email,
      phone: form.phone,
      isSEZ: form.isSEZ,
      isDeemedExport: form.isDeemedExport,
      preferredPaperSize: form.preferredPaperSize,
      preferredCurrency: form.preferredCurrency,
      autoPrint: form.autoPrint,
      creditLimit: Number.isFinite(limit) && limit > 0 ? Math.round(limit * 100) / 100 : '',
      priceLevel: form.priceLevel,
      ...openingFields(form, businessKey, localToday()),
      // Backward-compat flat fields kept for existing invoice/statement/GSTR consumers
      address: form.billingAddress.address,
      city: form.billingAddress.city,
      pin: form.billingAddress.pin,
      state: form.billingAddress.state,
      country: form.billingAddress.country,
      // Structured multi-address fields
      billingAddress: { ...form.billingAddress },
      shippingAddresses: shippingList,
      _v: 2,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>
            {isEditing ? 'Edit Client' : 'Add New Client'}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Client / Business Name *</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Acme Corp"
            />
          </div>

          <div className="form-group">
            <label className="form-label">{billingCc.taxIdLabel}</label>
            <input
              type="text"
              className="form-input"
              style={taxIdWarning ? { borderColor: '#f59e0b' } : undefined}
              value={form.gstin}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, gstin: e.target.value.toUpperCase() }));
                if (taxIdWarning) setTaxIdWarning('');
              }}
              onBlur={handleTaxIdBlur}
              placeholder={billingCc.taxIdPlaceholder}
              maxLength={20}
            />
            {taxIdWarning && (
              <small style={{ color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>
                ⚠ {taxIdWarning}
              </small>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="client@example.com"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input
              type="tel"
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="+91 98765 43210"
            />
          </div>

          {form.billingAddress.country === 'India' && (
            <>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!form.isSEZ}
                    onChange={(e) => setForm((prev) => ({ ...prev, isSEZ: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                  />
                  <span>
                    <strong>SEZ unit / Developer</strong> — supplies will be charged IGST regardless of state (Section 16, IGST Act).
                  </span>
                </label>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!form.isDeemedExport}
                    onChange={(e) => setForm((prev) => ({ ...prev, isDeemedExport: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                  />
                  <span>
                    <strong>Deemed export</strong> — EOU / EPCG / notified supply (Section 147, CGST Act).
                  </span>
                </label>
              </div>
            </>
          )}

          {/* Billing Address */}
          <div
            style={{
              gridColumn: 'span 2',
              borderTop: '1px solid var(--border)',
              paddingTop: '0.75rem',
              marginTop: '0.25rem',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.5rem',
              }}
            >
              Billing Address
            </div>
            <AddressFields
              addr={form.billingAddress}
              onChange={(ba) => setForm((prev) => ({ ...prev, billingAddress: ba }))}
              countryConfig={billingCc}
              stateOptions={billingStates}
            />
          </div>

          {/* Shipping Addresses */}
          <div
            style={{
              gridColumn: 'span 2',
              borderTop: '1px solid var(--border)',
              paddingTop: '0.75rem',
              marginTop: '0.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Shipping Address(es)
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.sameAsBilling}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setForm((prev) => ({ ...prev, sameAsBilling: true, shippingAddresses: [] }));
                    } else {
                      addShipping();
                    }
                  }}
                  style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
                />
                Same as billing
              </label>
            </div>

            {!form.sameAsBilling &&
              form.shippingAddresses.map((ship, idx) => {
                const shipCc = getCountryConfig(ship.country);
                const shipStates = getStatesForCountry(ship.country);
                return (
                  <div
                    key={ship.id}
                    style={{
                      position: 'relative',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '0.75rem',
                      marginBottom: '0.75rem',
                      background: ship.isDefault ? 'var(--bg-secondary)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>Shipping #{idx + 1}</span>
                        {ship.isDefault && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              background: 'var(--primary)',
                              color: '#fff',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            ★ Default
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        {!ship.isDefault && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Set as default"
                            onClick={() => setDefaultShipping(idx)}
                            style={{ fontSize: '0.72rem', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            <Star size={13} /> Default
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn"
                          title="Remove this address"
                          onClick={() => removeShipping(idx)}
                          style={{ color: '#dc2626', padding: '2px 6px' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>
                        Label (optional)
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        value={ship.label || ''}
                        onChange={(e) => updateShipping(idx, { ...ship, label: e.target.value })}
                        placeholder="e.g. Warehouse, Head Office"
                        style={{ fontSize: '0.85rem' }}
                      />
                    </div>

                    <AddressFields
                      addr={ship}
                      onChange={(updated) => updateShipping(idx, updated)}
                      countryConfig={shipCc}
                      stateOptions={shipStates}
                    />
                  </div>
                );
              })}

            {!form.sameAsBilling && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addShipping}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              >
                <Plus size={14} /> Add another shipping address
              </button>
            )}
          </div>

          {/* Credit limit & Price level (v1.10.85) */}
          <div className="form-group" style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: levels.length ? '1fr 1fr' : '1fr', gap: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            <div>
              <label htmlFor="client-credit-limit" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                Credit limit (optional)
              </label>
              <input
                id="client-credit-limit"
                type="number"
                min="0"
                step="any"
                className="form-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                value={form.creditLimit}
                placeholder="No limit"
                onChange={(e) => setForm((prev) => ({ ...prev, creditLimit: e.target.value }))}
                title="New Invoice warns when what they owe plus the new invoice goes over this. It never stops you."
              />
            </div>
            <PriceLevelSelect levels={levels} value={form.priceLevel} onChange={(v) => setForm((prev) => ({ ...prev, priceLevel: v }))} />
          </div>

          {/* Opening balance (v1.10.86 #214) */}
          <div className="form-group" style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
            <div>
              <label htmlFor="client-opening" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                Opening balance (optional) <HelpButton title="Opening balance" doc="clients#opening-balance" size={14} />
              </label>
              <input
                id="client-opening"
                type="number"
                min="0"
                step="any"
                className="form-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                value={form.openingBalance}
                placeholder="0"
                onChange={(e) => setForm((prev) => ({ ...prev, openingBalance: e.target.value }))}
                title="What this client owed you, or had paid you in advance, when you started using this app."
              />
            </div>
            <div>
              <label htmlFor="client-opening-date" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                As on
              </label>
              <input
                id="client-opening-date"
                type="date"
                className="form-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                value={form.openingBalanceDate}
                onChange={(e) => setForm((prev) => ({ ...prev, openingBalanceDate: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="client-opening-type" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                It is
              </label>
              <select
                id="client-opening-type"
                className="form-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                value={form.openingBalanceType}
                onChange={(e) => setForm((prev) => ({ ...prev, openingBalanceType: e.target.value }))}
              >
                <option value="receivable">Owed to you</option>
                <option value="advance">Their advance</option>
              </select>
            </div>
          </div>

          {/* Print preferences */}
          <div
            className="form-group"
            style={{
              gridColumn: 'span 2',
              paddingTop: '0.5rem',
              borderTop: '1px solid var(--border)',
              marginTop: '0.5rem',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.35rem',
              }}
            >
              Print preferences (optional) <HelpButton title="Client print preferences" doc="clients#client-print-prefs" size={16} />
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
              Auto-applied when you create a new invoice for this client. Leave blank to use app-wide defaults.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                  Preferred paper size
                </label>
                <select
                  className="form-input"
                  style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredPaperSize}
                  onChange={(e) => setForm((prev) => ({ ...prev, preferredPaperSize: e.target.value }))}
                >
                  <option value="">Use app default</option>
                  {Object.entries(PAPER_SIZES).map(([key, ps]) => (
                    <option key={key} value={key}>
                      {ps.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
                  Preferred currency
                </label>
                <select
                  className="form-input"
                  style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredCurrency}
                  onChange={(e) => setForm((prev) => ({ ...prev, preferredCurrency: e.target.value }))}
                >
                  <option value="">{abroad ? "Their country's currency" : 'Use invoice default'}</option>
                  {currencyCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <label
                style={{
                  gridColumn: 'span 2',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  marginTop: '0.2rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!form.autoPrint}
                  onChange={(e) => setForm((prev) => ({ ...prev, autoPrint: e.target.checked }))}
                  style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
                />
                <span>
                  <strong>Auto-print on save for this client</strong> — overrides global setting
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            {isEditing ? 'Update Client' : 'Save Client'}
          </button>
        </div>
      </div>
    </div>
  );
}
