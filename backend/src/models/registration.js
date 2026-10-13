import { randomBytes } from 'node:crypto';
import { maskPhone } from '../phone.js';

export function newId(prefix = 'reg') {
  return `${prefix}_${randomBytes(9).toString('hex')}`;
}

export function buildRegistration({ name, phoneE164, email, paymentsEnabled }) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    phoneE164,
    email,
    status: paymentsEnabled ? 'pending_payment' : 'processing',
    paymentStatus: paymentsEnabled ? 'pending' : 'not_required',
    payment: null,
    action: null,
    actionNote: null,
    failureCode: null,
    failureMessage: null,
    retryable: false,
    attempts: 0,
    adminReview: null,
    confirmationSource: null,
    createdAt: now,
    updatedAt: now,
  };
}

const INVITE_STATUSES = new Set([
  'invite_ready',
  'pending_admission',
  'awaiting_confirmation',
  'joined_confirmed',
]);

export function canRevealInvite(registration) {
  if (!registration) return false;
  if (registration.paymentStatus === 'pending' || registration.paymentStatus === 'failed') return false;
  return INVITE_STATUSES.has(registration.status);
}

export function publicMessage(registration, inviteVisible, queueInfo = null) {
  switch (registration.status) {
    case 'pending_payment':
      return 'Complete payment to continue. The group invitation appears only after the server verifies the payment.';
    case 'processing':
      if (queueInfo?.paused && queueInfo?.position) {
        return `WhatsApp asked to slow down. You are number ${queueInfo.position} in line, and adding continues after the administrator resumes it.`;
      }
      if (queueInfo?.position === 1) {
        return 'Your number is being added to the group now. This page updates automatically.';
      }
      if (queueInfo?.position) {
        return `You are number ${queueInfo.position} in line. People are added one at a time, and this page updates automatically.`;
      }
      return 'Your registration is being checked. This page updates automatically.';
    case 'invite_ready':
      return inviteVisible
        ? 'You are eligible to join. Open the invitation link below. If the link is passed around outside the group, the administrator can revoke it and replace it.'
        : 'You are eligible, and the administrator still needs to publish the invitation link.';
    case 'pending_admission':
      return inviteVisible
        ? 'Open the invitation link to request access. An administrator approves new members before they can enter.'
        : 'Your request is waiting for administrator approval.';
    case 'awaiting_confirmation':
      return 'A join step was recorded. Membership stays unconfirmed until an administrator sees you in the group.';
    case 'joined_confirmed':
      return 'This number was added to the group.';
    case 'failed':
      return registration.failureMessage || 'This registration could not be completed.';
    default:
      return 'Registration received.';
  }
}

export function publicView(registration, inviteLink, queueInfo = null) {
  const inviteVisible = canRevealInvite(registration) && Boolean(inviteLink);
  const line = registration.status === 'processing' ? queueInfo : null;
  return {
    id: registration.id,
    name: registration.name,
    phoneMasked: maskPhone(registration.phoneE164),
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    action: registration.action,
    failureCode: registration.failureCode,
    message: publicMessage(registration, inviteVisible, line),
    queuePosition: line?.position ?? null,
    queuePaused: Boolean(line?.paused),
    inviteLink: inviteVisible ? inviteLink : null,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
  };
}

const NOT_SAVED_NOTE = /contact_not_saved|save_contact_missing|contact_not_accepted|phone_field_missing|add_contact_missing|contact_form_missing|contact_search_missing|contact_not_found_after_save/;
const SAVED_NOTE = /Contact save was used once|already_in_contacts|save_clicked|contact was added to the group/;

export function contactSaveSummary(registration) {
  if (typeof registration.contactSaved === 'boolean') {
    return {
      contactSaved: registration.contactSaved,
      contactSavedName: registration.contactSavedName || registration.name,
      contactSaveReason: registration.contactSaveReason || null,
    };
  }
  const note = String(registration.actionNote || '');
  if (NOT_SAVED_NOTE.test(note) && !SAVED_NOTE.test(note)) {
    return { contactSaved: false, contactSavedName: registration.name, contactSaveReason: note };
  }
  if (SAVED_NOTE.test(note) || registration.confirmationSource === 'whatsapp_screen') {
    return { contactSaved: true, contactSavedName: registration.name, contactSaveReason: null };
  }
  return { contactSaved: null, contactSavedName: null, contactSaveReason: null };
}

export function adminView(registration) {
  return {
    ...registration,
    ...contactSaveSummary(registration),
    phoneMasked: maskPhone(registration.phoneE164),
  };
}

export function summarize(registrations) {
  const count = (predicate) => registrations.filter(predicate).length;
  return {
    total: registrations.length,
    pendingPayments: count((row) => row.status === 'pending_payment'),
    verifiedPayments: count((row) => row.paymentStatus === 'verified'),
    pendingAdmission: count((row) => row.status === 'pending_admission'),
    inviteReady: count((row) => row.status === 'invite_ready'),
    awaitingConfirmation: count((row) => row.status === 'awaiting_confirmation'),
    completed: count((row) => row.status === 'joined_confirmed'),
    failed: count((row) => row.status === 'failed'),
  };
}
