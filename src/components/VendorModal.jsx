import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import {
  getCountryConfig,
  getStatesForCountry,
  validateTaxId,
  detectCountryFromBrowser,
  getCountriesForRegion,
  decodeGstin,
} from '../utils';
import { getRegionMode, revealVendorBankDetails } from '../store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function makeEmptyForm(fallbackCountry) {
  return {
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    gstin: '',
    address: '',
    city: '',
    pin: '',
    state: '',
    country: fallbackCountry,
    paymentTermsDays: '',
    notes: '',
    bankDetails: {
      accountHolderName: '',
      bankName: '',
      accountNumber: '',
      routingCode: '',
    },
  };
}

export default function VendorModal({ show, onClose, onSave, vendor, isEditing, defaultCountry }) {
  const fallbackCountry = defaultCountry || detectCountryFromBrowser();
  const [form, setForm] = useState(() => makeEmptyForm(fallbackCountry));
  const [taxIdWarning, setTaxIdWarning] = useState('');
  const [errors, setErrors] = useState({});
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [showRoutingCode, setShowRoutingCode] = useState(false);
  const [revealingBank, setRevealingBank] = useState(false);
  const [bankRevealed, setBankRevealed] = useState(false);

  useEffect(() => {
    if (show && vendor) {
      const bank = vendor.bankDetails || {};
      setForm({
        name: vendor.name || '',
        contactPerson: vendor.contactPerson || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        gstin: vendor.gstin || '',
        address: vendor.address || '',
        city: vendor.city || '',
        pin: vendor.pin || '',
        state: vendor.state || '',
        country: vendor.country || fallbackCountry,
        paymentTermsDays: vendor.paymentTermsDays ?? '',
        notes: vendor.notes || '',
        bankDetails: {
          accountHolderName: bank.accountHolderName || '',
          bankName: bank.bankName || '',
          accountNumber: bank.accountNumberMasked || '',
          routingCode: bank.routingCodeMasked || '',
        },
      });
      setBankRevealed(false);
    } else if (show) {
      setForm(makeEmptyForm(fallbackCountry));
      setBankRevealed(true);
    }
    setTaxIdWarning('');
    setErrors({});
    setShowAccountNumber(false);
    setShowRoutingCode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, vendor]);

  if (!show) return null;

  const cc = getCountryConfig(form.country);
  const stateOptions = getStatesForCountry(form.country);

  const handleTaxIdBlur = () => {
    const result = validateTaxId(form.country, form.gstin);
    setTaxIdWarning(result.ok ? '' : result.message);
    if (form.country !== 'India') return;
    const decoded = decodeGstin(form.gstin);
    if (!decoded) return;
    if (!decoded.checksumOk) {
      setTaxIdWarning('This GSTIN fails its own checksum — check for a typo.');
      return;
    }
    if (!decoded.state) return;
    if (!form.state?.trim()) {
      setForm((prev) => ({ ...prev, state: decoded.state }));
    } else if (form.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setTaxIdWarning(`This GSTIN is registered in ${decoded.state}, but the state says ${form.state}.`);
    }
  };

  const handleRevealExistingBank = async () => {
    if (!isEditing || !vendor?.id || bankRevealed || revealingBank) return;
    setRevealingBank(true);
    try {
      const revealed = await revealVendorBankDetails(vendor.id);
      setForm((prev) => ({
        ...prev,
        bankDetails: {
          ...prev.bankDetails,
          accountNumber: revealed.accountNumber || '',
          routingCode: revealed.routingCode || '',
        },
      }));
      setBankRevealed(true);
      setShowAccountNumber(true);
      setShowRoutingCode(true);
    } catch {
      setErrors((prev) => ({ ...prev, bank: 'Could not decrypt saved bank details.' }));
    } finally {
      setRevealingBank(false);
    }
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Company / vendor name is required.';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    const acc = form.bankDetails.accountNumber.trim();
    if (acc && !acc.includes('•') && !/^[A-Za-z0-9\-\s]{6,34}$/.test(acc)) {
      next.accountNumber = 'Account number / IBAN should be 6–34 alphanumeric characters.';
    }
    const route = form.bankDetails.routingCode.trim();
    if (route && !route.includes('•') && !/^[A-Za-z0-9\-]{4,34}$/.test(route)) {
      next.routingCode = 'IFSC / Routing / SWIFT / IBAN code must be 4–34 alphanumeric characters.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      ...form,
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      gstin: form.gstin.trim().toUpperCase(),
      paymentTermsDays: form.paymentTermsDays === '' ? '' : Math.max(0, parseInt(form.paymentTermsDays, 10) || 0),
    });
  };

  const updateBank = (field, value) => {
    setForm((prev) => ({
      ...prev,
      bankDetails: { ...prev.bankDetails, [field]: value },
    }));
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>
            {isEditing ? 'Edit Vendor' : 'Add New Vendor'}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Company & Contact Details */}
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Company / Vendor Name *</label>
            <input
              type="text"
              className="form-input"
              style={errors.name ? { borderColor: '#dc2626' } : undefined}
              value={form.name}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }));
                if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="e.g. Bharat Paper & Packaging Pvt Ltd"
            />
            {errors.name && <small style={{ color: '#dc2626', fontSize: '0.72rem' }}>{errors.name}</small>}
          </div>

          <div className="form-group">
            <label className="form-label">Contact Person</label>
            <input
              type="text"
              className="form-input"
              value={form.contactPerson}
              onChange={(e) => setForm((prev) => ({ ...prev, contactPerson: e.target.value }))}
              placeholder="e.g. Rajesh Sharma"
            />
          </div>

          <div className="form-group">
            <label className="form-label">{cc.taxIdLabel}</label>
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
              placeholder={cc.taxIdPlaceholder}
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
              style={errors.email ? { borderColor: '#dc2626' } : undefined}
              value={form.email}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, email: e.target.value }));
                if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
              }}
              placeholder="accounts@vendor.com"
            />
            {errors.email && <small style={{ color: '#dc2626', fontSize: '0.72rem' }}>{errors.email}</small>}
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

          {/* Address */}
          <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
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
              Vendor Address
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Street Address</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Street address, industrial estate, locality"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <select
                  className="form-input"
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value, state: '' }))}
                >
                  {(() => {
                    const visible = getCountriesForRegion(getRegionMode());
                    const out = [];
                    if (form.country && !visible.some((c) => c.name === form.country)) {
                      out.push(
                        <option key={form.country} value={form.country}>
                          {form.country}
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
                  value={form.city}
                  onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="e.g. Pune"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{cc.postalLabel}</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.pin}
                  onChange={(e) => setForm((prev) => ({ ...prev, pin: e.target.value }))}
                  placeholder={cc.postalLabel}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{cc.stateLabel}</label>
                {stateOptions.length > 0 ? (
                  <select
                    className="form-input"
                    value={form.state}
                    onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
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
                    value={form.state}
                    onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
                    placeholder={cc.stateLabel}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Bank Details (Encrypted at rest, masked in UI) */}
          <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <ShieldCheck size={14} style={{ color: '#059669' }} />
                Bank Details (Encrypted &amp; Masked)
              </div>
              {isEditing && !bankRevealed && (vendor?.bankDetails?.hasAccountNumber || vendor?.bankDetails?.hasRoutingCode) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                  onClick={handleRevealExistingBank}
                  disabled={revealingBank}
                >
                  <Eye size={12} /> {revealingBank ? 'Decrypting...' : 'Reveal saved details'}
                </button>
              )}
            </div>
            {errors.bank && <small style={{ color: '#dc2626', fontSize: '0.72rem', display: 'block', marginBottom: '0.35rem' }}>{errors.bank}</small>}

            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label">Account Holder Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.bankDetails.accountHolderName}
                  onChange={(e) => updateBank('accountHolderName', e.target.value)}
                  placeholder="Beneficiary name"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bank Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.bankDetails.bankName}
                  onChange={(e) => updateBank('bankName', e.target.value)}
                  placeholder="e.g. HDFC Bank"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Account Number / IBAN</label>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input
                    type={showAccountNumber || form.bankDetails.accountNumber.includes('•') ? 'text' : 'password'}
                    className="form-input"
                    style={errors.accountNumber ? { borderColor: '#dc2626' } : undefined}
                    value={form.bankDetails.accountNumber}
                    autoComplete="off"
                    onFocus={() => {
                      if (form.bankDetails.accountNumber.includes('•')) {
                        updateBank('accountNumber', '');
                      }
                    }}
                    onChange={(e) => {
                      updateBank('accountNumber', e.target.value);
                      if (errors.accountNumber) setErrors((prev) => ({ ...prev, accountNumber: '' }));
                    }}
                    placeholder="Enter account number or IBAN"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title={showAccountNumber ? 'Hide' : 'Show'}
                    onClick={() => setShowAccountNumber((s) => !s)}
                  >
                    {showAccountNumber ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.accountNumber && <small style={{ color: '#dc2626', fontSize: '0.72rem' }}>{errors.accountNumber}</small>}
              </div>
              <div className="form-group">
                <label className="form-label">IFSC / Routing / SWIFT</label>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input
                    type={showRoutingCode || form.bankDetails.routingCode.includes('•') ? 'text' : 'password'}
                    className="form-input"
                    style={errors.routingCode ? { borderColor: '#dc2626' } : undefined}
                    value={form.bankDetails.routingCode}
                    autoComplete="off"
                    onFocus={() => {
                      if (form.bankDetails.routingCode.includes('•')) {
                        updateBank('routingCode', '');
                      }
                    }}
                    onChange={(e) => {
                      updateBank('routingCode', e.target.value.toUpperCase());
                      if (errors.routingCode) setErrors((prev) => ({ ...prev, routingCode: '' }));
                    }}
                    placeholder="e.g. HDFC0001234 / SWIFT"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title={showRoutingCode ? 'Hide' : 'Show'}
                    onClick={() => setShowRoutingCode((s) => !s)}
                  >
                    {showRoutingCode ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.routingCode && <small style={{ color: '#dc2626', fontSize: '0.72rem' }}>{errors.routingCode}</small>}
              </div>
            </div>
          </div>

          {/* Payment Terms */}
          <div className="form-group">
            <label className="form-label">Default Payment Terms (days)</label>
            <input
              type="number"
              min="0"
              className="form-input"
              value={form.paymentTermsDays}
              onChange={(e) => setForm((prev) => ({ ...prev, paymentTermsDays: e.target.value }))}
              placeholder="e.g. 30 (Net 30)"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input
              type="text"
              className="form-input"
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional vendor notes"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            {isEditing ? 'Update Vendor' : 'Save Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}
