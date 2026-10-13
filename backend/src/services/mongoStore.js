import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { summarize } from '../models/registration.js';

function clean(document) {
  if (!document) return null;
  const { _id, ...rest } = document;
  return rest;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function createMongoStore(config) {
  const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
  } catch {
    const error = new Error('Database unavailable');
    error.code = 'database_unavailable';
    throw error;
  }

  const db = client.db();
  const registrations = db.collection('registrations');
  const payments = db.collection('payments');
  const logs = db.collection('logs');
  const settingsCol = db.collection('settings');

  await registrations.createIndex({ phoneE164: 1 }, { unique: true });
  await registrations.createIndex({ id: 1 }, { unique: true });
  await payments.createIndex({ paymentId: 1 }, { unique: true });

  const existing = await settingsCol.findOne({ _id: 'app' });
  if (!existing) {
    await settingsCol.insertOne({
      _id: 'app',
      inviteLink: config.groupInviteLink || '',
      admissionMode: config.admissionMode,
      groupName: config.groupName || '',
      inviteLinkUpdatedAt: null,
    });
  }

  return {
    async createRegistration(record) {
      try {
        await registrations.insertOne({ ...record });
        return record;
      } catch (error) {
        if (error.code === 11000) {
          const duplicate = new Error('duplicate');
          duplicate.code = 'duplicate_registration';
          duplicate.existing = clean(await registrations.findOne({ phoneE164: record.phoneE164 }));
          throw duplicate;
        }
        throw error;
      }
    },
    async getRegistration(id) {
      return clean(await registrations.findOne({ id }));
    },
    async getByPhone(phoneE164) {
      return clean(await registrations.findOne({ phoneE164 }));
    },
    async getByOrderId(orderId) {
      return clean(await registrations.findOne({ 'payment.orderId': orderId }));
    },
    async updateRegistration(id, patch) {
      const { id: _id, phoneE164: _phone, createdAt: _created, ...safe } = patch;
      const updated = await registrations.findOneAndUpdate(
        { id },
        { $set: { ...safe, updatedAt: new Date().toISOString() } },
        { returnDocument: 'after' },
      );
      return clean(updated);
    },
    async listRegistrations({ q = '', limit = 100, status = '', oldestFirst = false } = {}) {
      const needle = String(q || '').trim();
      const filter = {};
      if (status) filter.status = status;
      if (needle) {
        filter.$or = [
          { name: { $regex: escapeRegex(needle), $options: 'i' } },
          { id: { $regex: escapeRegex(needle), $options: 'i' } },
          { phoneE164: { $regex: escapeRegex(needle), $options: 'i' } },
        ];
      }
      const rows = await registrations.find(filter).sort({ createdAt: oldestFirst ? 1 : -1 }).limit(limit).toArray();
      return rows.map(clean);
    },
    async stats() {
      const rows = await registrations.find({}, { projection: { status: 1, paymentStatus: 1 } }).toArray();
      return summarize(rows);
    },
    async getSettings() {
      const doc = await settingsCol.findOne({ _id: 'app' });
      return clean(doc);
    },
    async saveSettings(partial) {
      await settingsCol.updateOne({ _id: 'app' }, { $set: partial }, { upsert: true });
      return this.getSettings();
    },
    async addLog(entry) {
      await logs.insertOne({
        id: randomBytes(6).toString('hex'),
        at: new Date().toISOString(),
        level: entry.level || 'info',
        event: entry.event,
        registrationId: entry.registrationId || null,
        detail: entry.detail || {},
      });
    },
    async listLogs(limit = 100) {
      const rows = await logs.find({}).sort({ at: -1 }).limit(limit).toArray();
      return rows.map(clean);
    },
    async recordPayment(payment) {
      try {
        await payments.insertOne({ ...payment, recordedAt: new Date().toISOString() });
        return { created: true };
      } catch (error) {
        if (error.code === 11000) return { created: false };
        throw error;
      }
    },
    async getPaymentByPaymentId(paymentId) {
      return clean(await payments.findOne({ paymentId }));
    },
    async close() {
      await client.close();
    },
  };
}
