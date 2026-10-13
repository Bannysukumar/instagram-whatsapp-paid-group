function failure(code, retryable, message) {
  return {
    status: 'failed',
    action: null,
    actionNote: null,
    failureCode: code,
    failureMessage: message,
    retryable,
  };
}

function finishWithInvite({ link, admissionMode, action, actionNote = null }) {
  if (!link) {
    return failure(
      'invite_link_missing',
      false,
      'The group invitation link is not configured yet. Add it from the administrator settings.',
    );
  }
  const status = admissionMode === 'approval' ? 'pending_admission' : 'invite_ready';
  return {
    status,
    action,
    actionNote,
    failureCode: null,
    failureMessage: null,
    retryable: false,
  };
}

async function readSession(whatsapp) {
  try {
    return await whatsapp.checkSession();
  } catch {
    try {
      return await whatsapp.checkSession();
    } catch {
      return null;
    }
  }
}

export async function processMembership({ registration, settings, config, whatsapp }) {
  if (config.paymentsEnabled && registration.paymentStatus !== 'verified') {
    return failure('payment_required', false, 'Payment has to be verified before group access is offered.');
  }

  const link = String(settings.inviteLink || '').trim();

  if (!config.directAddEnabled) {
    return finishWithInvite({
      link,
      admissionMode: settings.admissionMode,
      action: 'invite_link',
    });
  }

  if (!whatsapp) {
    return failure('browser_crash', true, 'The WhatsApp browser worker is not available. Retry after it starts.');
  }

  const session = await readSession(whatsapp);
  if (!session) {
    return failure('browser_crash', true, 'The automation browser closed unexpectedly. You can retry this task.');
  }
  if (session.state !== 'authenticated') {
    const pendingLogin = finishWithInvite({
      link,
      admissionMode: settings.admissionMode,
      action: 'direct_add_unavailable',
      actionNote: 'qr_login_required',
    });
    return link ? { ...pendingLogin, retryable: true } : pendingLogin;
  }

  let addResult;
  try {
    addResult = await whatsapp.tryAddParticipant({
      groupName: settings.groupName,
      inviteLink: link,
      phone: registration.phoneE164,
      contactName: registration.name,
    });
  } catch {
    return failure('browser_crash', true, 'The browser closed during the group check. You can retry this task.');
  }

  function withContact(result) {
    if (!addResult?.contact) return result;
    return {
      ...result,
      contactSavedName: registration.name,
      contactSaved: Boolean(addResult.contact.saved),
      contactSaveReason: addResult.contact.reason || null,
    };
  }

  if (addResult?.outcome === 'session_required') {
    const pendingLogin = finishWithInvite({
      link,
      admissionMode: settings.admissionMode,
      action: 'direct_add_unavailable',
      actionNote: 'qr_login_required',
    });
    return withContact(link ? { ...pendingLogin, retryable: true } : pendingLogin);
  }

  if (addResult?.outcome === 'rate_limited') {
    const held = finishWithInvite({
      link,
      admissionMode: settings.admissionMode,
      action: 'direct_add_unavailable',
      actionNote: 'whatsapp_limit',
    });
    return withContact({
      ...held,
      retryable: true,
      pauseQueue: true,
      pauseReason: 'whatsapp_limit',
    });
  }

  if (addResult?.outcome === 'added_confirmed') {
    return withContact({
      status: 'joined_confirmed',
      action: 'direct_add_attempted',
      actionNote: 'WhatsApp showed that this contact was added to the group.',
      failureCode: null,
      failureMessage: null,
      retryable: false,
      confirmationSource: 'whatsapp_screen',
    });
  }

  if (addResult?.outcome === 'submitted_unconfirmed') {
    return withContact({
      status: 'awaiting_confirmation',
      action: 'direct_add_attempted',
      actionNote: addResult.contact?.saved
        ? 'Contact save was used once, then the add control was used once. WhatsApp did not confirm membership.'
        : 'The add control was used once. WhatsApp did not confirm membership.',
      failureCode: null,
      failureMessage: null,
      retryable: false,
    });
  }

  const reason = [addResult?.contact?.reason, addResult?.reason].filter(Boolean).join('; ') || 'direct_add_unavailable';
  return withContact(finishWithInvite({
    link,
    admissionMode: settings.admissionMode,
    action: 'direct_add_unavailable',
    actionNote: reason,
  }));
}
