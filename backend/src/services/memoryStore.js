import { randomBytes } from 'node:crypto';
import { summarize } from '../models/registration.js';

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStore(seed = {}) {
  const registrations = new Map();
  const payments = [];
  const logs = [];
  let settings = {
    inviteLink: seed.inviteLink || '',
    admissionMode: seed.admissionMode === 'approval' ? 'approval' : 'invite',
    groupName: seed.groupName || '',
    inviteLinkUpdatedAt: seed.inviteLinkUpdatedAt || null,
  };

  function phoneOwner(phoneE164) {
    for (const row of registrations.values()) {
      if (row.phoneE164 === phoneE164) return row;
    }
    return null;
  }

  return {
    async createRegistration(record) {
      const existing = phoneOwner(record.phoneE164);
      if (existing) {
        const error = new Error('duplicate');
        error.code = 'duplicate_registration';
        error.existing = clone(existing);
        throw error;
      }
      registrations.set(record.id, clone(record));
      return clone(record);
    },
    async getRegistration(id) {
      const found = registrations.get(id);
      return found ? clone(found) : null;
    },
    async getByPhone(phoneE164) {
      const found = phoneOwner(phoneE164);
      return found ? clone(found) : null;
    },
    async getByOrderId(orderId) {
      for (const row of registrations.values()) {
        if (row.payment?.orderId === orderId) return clone(row);
      }
      return null;
    },
    async updateRegistration(id, patch) {
      const current = registrations.get(id);
      if (!current) return null;
      const { id: _id, phoneE164: _phone, createdAt: _created, ...safe } = patch;
      const next = {
        ...current,
        ...safe,
        id: current.id,
        phoneE164: current.phoneE164,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      registrations.set(id, next);
      return clone(next);
    },
    async listRegistrations({ q = '', limit = 100, status = '', oldestFirst = false } = {}) {
      const needle = String(q || '').trim().toLowerCase();
      const digits = needle.replace(/\D/g, '');
      let rows = [...registrations.values()];
      if (status) rows = rows.filter((row) => row.status === status);
      if (needle) {
        rows = rows.filter((row) => {
          const phoneDigits = row.phoneE164.replace(/\D/g, '');
          return row.name.toLowerCase().includes(needle)
            || row.id.toLowerCase().includes(needle)
            || row.phoneE164.toLowerCase().includes(needle)
            || (digits.length >= 4 && phoneDigits.includes(digits));
        });
      }
      rows.sort((a, b) => (oldestFirst ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
      return rows.slice(0, limit).map(clone);
    },
    async stats() {
      return summarize([...registrations.values()]);
    },
    async getSettings() {
      return clone(settings);
    },
    async saveSettings(partial) {
      settings = { ...settings, ...partial };
      return clone(settings);
    },
    async addLog(entry) {
      logs.unshift({
        id: randomBytes(6).toString('hex'),
        at: new Date().toISOString(),
        level: entry.level || 'info',
        event: entry.event,
        registrationId: entry.registrationId || null,
        detail: entry.detail || {},
      });
      if (logs.length > 500) logs.length = 500;
    },
    async listLogs(limit = 100) {
      return logs.slice(0, limit).map(clone);
    },
    async recordPayment(payment) {
      if (payments.some((item) => item.paymentId === payment.paymentId)) {
        return { created: false };
      }
      payments.push({ ...payment, recordedAt: new Date().toISOString() });
      return { created: true };
    },
    async getPaymentByPaymentId(paymentId) {
      const found = payments.find((item) => item.paymentId === paymentId);
      return found ? clone(found) : null;
    },
    exportState() {
      return {
        registrations: [...registrations.values()].map(clone),
        settings: clone(settings),
        payments: payments.map(clone),
        logs: logs.map(clone),
      };
    },
    async hydrate(state) {
      registrations.clear();
      payments.length = 0;
      logs.length = 0;
      if (state.settings) settings = { ...settings, ...state.settings };
      for (const row of state.registrations || []) {
        registrations.set(row.id, clone(row));
      }
      for (const payment of state.payments || []) payments.push(clone(payment));
      for (const entry of state.logs || []) logs.push(clone(entry));
    },
  };
}
