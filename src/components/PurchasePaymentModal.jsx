// v1.10.83 (#123) - record, change and delete payments to the supplier on a
// purchase bill, with its payment history. Laid out like Record Payment on the
// Dashboard. The maths is in utils/purchasePayments.js (unit-tested).
import { useState, useEffect, useMemo } from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { savePurchase, getProfile } from '../store';
import { formatCurrency, localToday } from '../utils';
import {
  PURCHASE_PAYMENT_MODES, OVERPAY_SLACK, purchasePaymentModeName, purchaseTotal, purchaseOwed, purchasePaid, purchaseRcmTax,
  purchasePaymentDue, hasPurchasePayments, validatePurchasePayment, withPurchasePayments, newPurchasePaymentId,
} from '../utils/purchasePayments';
import HelpButton from './HelpButton';
import { toast } from './Toast';
import { confirmAction } from './ConfirmModal';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ELECTRONIC_MODES = new Set(['neft', 'rtgs', 'imps', 'upi', 'bank-transfer']);

function formatBankOption(bankName, accountNumber) {
  const acc = String(accountNumber || '').trim();
  const masked = acc.length > 4 ? `****${acc.slice(-4)}` : acc;
  return [String(bankName || '').trim(), masked].filter(Boolean).join(' - ');
}

const blankFor = (bill, defaultBank = '') => ({
  amount: String(purchasePaymentDue(bill) || ''),
  date: localToday(),
  mode: 'neft',
  reference: '',
  sourceBankAccount: defaultBank,
  customBankAccount: '',
  note: '',
});

export default function PurchasePaymentModal({ purchase, allPurchases = [], onClose, onChanged }) {
  const [bill, setBill] = useState(purchase);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [form, setForm] = useState(() => blankFor(purchase));
  const [editIdx, setEditIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile()
      .then((prof) => {
        if (!prof) return;
        const opts = [];
        const primary = formatBankOption(prof.bankName, prof.accountNumber);
        if (primary) opts.push(primary);
        if (Array.isArray(prof.bankAccounts)) {
          for (const b of prof.bankAccounts) {
            const label = formatBankOption(b?.bankName, b?.accountNumber);
            if (label && !opts.includes(label)) opts.push(label);
          }
        }
        setBankAccounts(opts);
        if (opts.length > 0) {
          setForm((prev) =>
            prev.sourceBankAccount ? prev : { ...prev, sourceBankAccount: opts[0] }
          );
        }
      })
      .catch(() => {});
  }, []);

  const accountChoices = useMemo(() => {
    const list = [...bankAccounts];
    if (!list.includes('Cash Account')) list.push('Cash Account');
    list.push('__custom__');
    return list;
  }, [bankAccounts]);

  const payments = bill.payments || [];
  const total = purchaseTotal(bill);
  const owed = purchaseOwed(bill);
  const paid = purchasePaid(bill);
  const legacyPaid = !hasPurchasePayments(bill) && bill.paymentStatus === 'Paid';
  const set = (k) => (e) => {
    const val = e.target.value;
    setForm((prev) => {
      const next = { ...prev, [k]: val };
      if (k === 'mode' && val === 'cash' && (!prev.sourceBankAccount || prev.sourceBankAccount === bankAccounts[0])) {
        next.sourceBankAccount = 'Cash Account';
      } else if (k === 'mode' && val !== 'cash' && prev.sourceBankAccount === 'Cash Account' && bankAccounts[0]) {
        next.sourceBankAccount = bankAccounts[0];
      }
      return next;
    });
  };

  // Saves the bill with these payments; the updated bill, or null if it failed.
  const persist = async (nextPayments) => {
    const updated = withPurchasePayments(bill, nextPayments);
    setSaving(true);
    try {
      await savePurchase(updated);
      setBill(updated);
      onChanged(updated);
      return updated;
    } catch (err) {
      toast(err?.message && !/^API error/.test(err.message) ? err.message : 'Could not save the payment. Try again.', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const resolvedSourceBank = () => {
    if (form.sourceBankAccount === '__custom__') return form.customBankAccount.trim();
    return (form.sourceBankAccount || '').trim();
  };

  const save = async () => {
    const sourceBankAccount = resolvedSourceBank();
    const ref = form.reference.trim();
    if (!form.mode) {
      toast('Select a payment mode', 'warning');
      return;
    }
    if (!ref) {
      toast(
        form.mode === 'cash'
          ? 'Enter a cash voucher / receipt reference'
          : 'UTR / transaction reference number is required',
        'warning'
      );
      return;
    }
    if (!sourceBankAccount) {
      toast('Source bank account is required', 'warning');
      return;
    }
    if (bill.date && form.date && form.date < bill.date) {
      toast(`Payment date cannot be earlier than bill date (${bill.date})`, 'warning');
      return;
    }

    const base = editIdx !== null ? payments[editIdx] : { id: newPurchasePaymentId(), recordedAt: new Date().toISOString() };
    const entry = {
      ...base,
      amount: r2(form.amount),
      date: form.date,
      mode: form.mode,
      reference: ref,
      sourceBankAccount,
      note: form.note.trim(),
      ...(editIdx !== null ? { auto: false } : {}),
    };
    const problem = validatePurchasePayment({ ...entry, amount: Number(form.amount) });
    if (problem) {
      toast(problem, 'warning');
      return;
    }

    const others = r2(paid - (editIdx !== null ? Number(payments[editIdx].amount) || 0 : 0));
    if (others + entry.amount > owed + OVERPAY_SLACK) {
      toast(`That is more than the ${formatCurrency(Math.max(0, owed - others))} still to pay on this bill`, 'warning');
      return;
    }

    // UTR uniqueness check for electronic transfers
    if (ELECTRONIC_MODES.has(form.mode)) {
      const refLower = ref.toLowerCase();
      const dupOnBill = payments.some(
        (x, i) => i !== editIdx && String(x.reference || '').trim().toLowerCase() === refLower
      );
      if (dupOnBill) {
        toast(`Reference "${ref}" is already recorded on this bill`, 'warning');
        return;
      }
      const dupOther = (allPurchases || []).find(
        (p) =>
          p.id !== bill.id &&
          (p.payments || []).some(
            (x) =>
              String(x.reference || '').trim().toLowerCase() === refLower &&
              (!x.sourceBankAccount || x.sourceBankAccount === sourceBankAccount)
          )
      );
      if (dupOther) {
        const proceedDup = await confirmAction({
          title: 'Duplicate UTR / Reference detected',
          message: `Reference "${ref}" (${sourceBankAccount}) is already used on bill ${dupOther.invoiceNumber || dupOther.id}. Record it on this bill too?`,
          confirmLabel: 'Record anyway',
        });
        if (!proceedDup) return;
      }
    }

    const next = editIdx !== null ? payments.map((x, i) => (i === editIdx ? entry : x)) : [...payments, entry];
    const updated = await persist(next);
    if (!updated) return;
    const left = purchasePaymentDue(updated);
    if (editIdx !== null) {
      toast('Payment updated', 'success');
      setEditIdx(null);
      setForm(blankFor(updated, bankAccounts[0] || ''));
      return;
    }
    toast(`Payment of ${formatCurrency(entry.amount)} recorded${left > 0.005 ? ` · ${formatCurrency(left)} left to pay` : ' · bill paid'}`, 'success');
    onClose();
  };

  const startEdit = (i) => {
    const x = payments[i];
    const bankVal = x.sourceBankAccount || '';
    const inChoices = !bankVal || bankAccounts.includes(bankVal) || bankVal === 'Cash Account';
    setEditIdx(i);
    setForm({
      amount: String(x.amount ?? ''),
      date: x.date || localToday(),
      mode: x.mode || 'neft',
      reference: x.reference || '',
      sourceBankAccount: inChoices ? (bankVal || bankAccounts[0] || '') : '__custom__',
      customBankAccount: inChoices ? '' : bankVal,
      note: x.note || '',
    });
  };
  const cancelEdit = () => {
    setEditIdx(null);
    setForm(blankFor(bill, bankAccounts[0] || ''));
  };

  const remove = async (i) => {
    const x = payments[i];
    if (
      !(await confirmAction({
        title: 'Delete this payment?',
        message: `${formatCurrency(x.amount)} paid on ${x.date || '-'} (${purchasePaymentModeName(x.mode)}) is removed. The bill goes back to Partly paid or Unpaid${x.mode === 'cash' ? ', and the Cash book no longer shows it' : ''}.`,
        confirmLabel: 'Delete payment',
        tone: 'danger',
      }))
    )
      return;
    const updated = await persist(payments.filter((_, j) => j !== i));
    if (!updated) return;
    toast('Payment deleted', 'success');
    setEditIdx(null);
    setForm(blankFor(updated, bankAccounts[0] || ''));
  };

  const balance = r2(owed - paid);
  const rcm = purchaseRcmTax(bill); // v1.10.86 - reverse charge: GST you pay, not the supplier
  const tds = r2(total - rcm - owed);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h3 className="section-title">
          {editIdx !== null ? 'Edit payment' : 'Record payment to supplier'}{' '}
          <HelpButton title="Paying a supplier" doc="purchases#record-payment" size={16} style={{ marginLeft: 6 }} />
        </h3>
        <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem', lineHeight: 1.6 }}>
          Bill: <strong>{bill.invoiceNumber || '-'}</strong> · {bill.supplierName || '-'}
          <br />
          Total: <strong>{formatCurrency(total)}</strong>
          {rcm > 0.005 && (
            <>
              {' '}
              | Less GST you pay (reverse charge): <strong>{formatCurrency(rcm)}</strong>
            </>
          )}
          {tds > 0.005 && (
            <>
              {' '}
              | Less TDS: <strong>{formatCurrency(tds)}</strong>
            </>
          )}
          {paid > 0.005 && (
            <>
              {' '}
              | Paid: <strong>{formatCurrency(paid)}</strong>
            </>
          )}{' '}
          | Balance:{' '}
          <strong style={{ color: legacyPaid || balance <= 0.005 ? 'var(--success)' : 'var(--danger)' }}>
            {formatCurrency(legacyPaid ? 0 : Math.max(0, balance))}
          </strong>
        </p>
        {legacyPaid && (
          <div className="notice notice-info" style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
            This bill was marked <b>Paid</b> without amounts. Recording a payment here replaces that mark: the status then follows the payments you enter.
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="form-label" htmlFor="ppay-amount">
              Amount paid *
            </label>
            <input
              id="ppay-amount"
              type="number"
              min="0"
              step="any"
              className="form-input"
              value={form.amount}
              onFocus={(e) => e.target.select()}
              onChange={set('amount')}
              placeholder={String(Math.max(0, balance))}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ppay-date">
              Payment date *
            </label>
            <input id="ppay-date" type="date" className="form-input" value={form.date} onChange={set('date')} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ppay-mode">
              Payment mode *
            </label>
            <select id="ppay-mode" className="form-input" value={form.mode} onChange={set('mode')}>
              {PURCHASE_PAYMENT_MODES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ppay-ref">
              {form.mode === 'cash' ? 'Voucher / receipt ref *' : 'UTR / transaction ref *'}
            </label>
            <input
              id="ppay-ref"
              type="text"
              className="form-input"
              maxLength={60}
              value={form.reference}
              onChange={set('reference')}
              placeholder={form.mode === 'cash' ? 'Cash voucher / receipt no.' : 'UTR, UPI ref, cheque no.'}
            />
          </div>
          <div className="form-group" style={{ gridColumn: form.sourceBankAccount === '__custom__' ? 'span 1' : 'span 2' }}>
            <label className="form-label" htmlFor="ppay-bank">
              Source bank account *
            </label>
            <select id="ppay-bank" className="form-input" value={form.sourceBankAccount} onChange={set('sourceBankAccount')}>
              {accountChoices.map((acc) => (
                <option key={acc} value={acc}>
                  {acc === '__custom__' ? 'Other / enter bank account...' : acc}
                </option>
              ))}
            </select>
          </div>
          {form.sourceBankAccount === '__custom__' && (
            <div className="form-group">
              <label className="form-label" htmlFor="ppay-custom-bank">
                Bank account name / no. *
              </label>
              <input
                id="ppay-custom-bank"
                type="text"
                className="form-input"
                maxLength={120}
                value={form.customBankAccount}
                onChange={set('customBankAccount')}
                placeholder="e.g. HDFC Current - ****4821"
              />
            </div>
          )}
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label" htmlFor="ppay-note">
              Remarks (optional)
            </label>
            <input
              id="ppay-note"
              type="text"
              className="form-input"
              maxLength={300}
              value={form.note}
              onChange={set('note')}
              placeholder="Anything to remember"
            />
          </div>
        </div>
        {form.mode === 'cash' && (
          <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
            Cash payments also show in the Cash book as money out. Do not add them there again.
          </p>
        )}
        {payments.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <label className="form-label">
              Payment History <HelpButton title="Payment history" doc="purchases#payment-history" size={14} />
            </label>
            <div className="payment-history">
              {payments.map((x, i) => (
                <div
                  key={x.id || i}
                  className="payment-row"
                  style={{
                    display: 'flex',
                    gap: '0.4rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    outline: editIdx === i ? '2px solid var(--primary)' : undefined,
                  }}
                >
                  <span style={{ minWidth: 90 }}>{x.date ? new Date(`${x.date}T00:00:00`).toLocaleDateString('en-IN') : '-'}</span>
                  <span className="font-bold" style={{ minWidth: 100 }}>
                    {formatCurrency(x.amount)}
                  </span>
                  <span className="text-muted" style={{ minWidth: 80 }}>
                    {purchasePaymentModeName(x.mode)}
                  </span>
                  {(x.sourceBankAccount || x.reference || x.note) && (
                    <span className="text-muted" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      · {[x.sourceBankAccount, x.reference, x.note].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                      disabled={saving}
                      onClick={() => startEdit(i)}
                      title="Edit amount / date / mode / reference"
                      aria-label="Edit this payment"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      disabled={saving}
                      onClick={() => remove(i)}
                      title="Delete this payment"
                      aria-label="Delete this payment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 justify-end mt-4">
          {editIdx !== null && (
            <button type="button" className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>
              Cancel edit
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editIdx !== null ? 'Update payment' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
