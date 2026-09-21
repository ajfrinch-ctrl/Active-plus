/**
 * Admin Panel v2 — one-tap CSV exports (রিপোর্ট: সবকিছু এক্সপোর্ট).
 *
 * The report centre already exports branded PDF/Excel documents; these header
 * buttons cover the everyday raw-data exports an office needs for Excel:
 * the full student list, the live dues register and every recorded payment.
 * All three reuse the shared toCSV()/downloadText() helpers, so the files
 * they produce are exactly what the rest of the app exports.
 */
import { db, dueFees, toCSV, downloadText } from '../data.js';
import { showToast } from '../app.js';

export function mountAdminExports() {
  const stamp = () => new Date().toISOString().slice(0, 10);

  const studentsBtn = document.getElementById('students-csv');
  studentsBtn?.addEventListener('click', () => {
    const rows = db.students.list();
    const csv = toCSV([
      { label: 'আইডি', key: 'id' },
      { label: 'নাম', key: 'name' },
      { label: 'শ্রেণি', key: 'className' },
      { label: 'শাখা', key: 'section' },
      { label: 'রোল', key: 'roll' },
      { label: 'স্কুল/কলেজ', key: 'school' },
      { label: 'মোবাইল', key: 'phone' },
      { label: 'অভিভাবক', key: 'guardian' },
      { label: 'ভর্তির তারিখ', key: 'admissionDate' },
      { label: 'অবস্থা', key: 'status' }
    ], rows);
    downloadText(`students-${stamp()}.csv`, csv, 'text/csv');
    showToast('শিক্ষার্থী তালিকা (CSV) ডাউনলোড হয়েছে।', 'success');
  });

  const duesBtn = document.getElementById('dues-csv');
  duesBtn?.addEventListener('click', () => {
    const rows = dueFees().map((due) => ({
      id: due.studentId,
      name: due.student?.name || '',
      className: due.student?.className || '',
      month: due.month || '',
      amount: due.remaining,
      status: 'বকেয়া'
    }));
    const csv = toCSV([
      { label: 'আইডি', key: 'id' },
      { label: 'নাম', key: 'name' },
      { label: 'শ্রেণি', key: 'className' },
      { label: 'মাস', key: 'month' },
      { label: 'বকেয়া টাকা', key: 'amount' },
      { label: 'অবস্থা', key: 'status' }
    ], rows);
    downloadText(`dues-${stamp()}.csv`, csv, 'text/csv');
    showToast('বকেয়া তালিকা (CSV) ডাউনলোড হয়েছে।', 'success');
  });

  const paymentsBtn = document.getElementById('payments-csv');
  paymentsBtn?.addEventListener('click', () => {
    const rows = db.payments.list().map((p) => {
      const student = db.students.find(p.studentId) || {};
      return {
        receipt: p.receiptNo || p.id,
        date: p.date,
        id: p.studentId,
        name: student.name || '',
        months: p.month || '',
        amount: p.amount,
        method: p.method || ''
      };
    });
    const csv = toCSV([
      { label: 'রসিদ নং', key: 'receipt' },
      { label: 'তারিখ', key: 'date' },
      { label: 'আইডি', key: 'id' },
      { label: 'নাম', key: 'name' },
      { label: 'মাস', key: 'months' },
      { label: 'টাকা', key: 'amount' },
      { label: 'মাধ্যম', key: 'method' }
    ], rows);
    downloadText(`payments-${stamp()}.csv`, csv, 'text/csv');
    showToast('পেমেন্ট তালিকা (CSV) ডাউনলোড হয়েছে।', 'success');
  });
}
