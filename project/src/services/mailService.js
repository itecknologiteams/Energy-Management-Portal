'use strict';

/**
 * Mail service — sends email through the SMTP server configured in
 * config/alerts.json (email.smtp). The transport is rebuilt automatically when
 * the SMTP settings change.
 */

const { getAlertConfig } = require('../config/alertConfig');

let transport = null;
let transportKey = null;

function buildTransport(smtp) {
  // Required lazily so the API still starts if the package is missing;
  // only email sending fails, with a clear message.
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('nodemailer is not installed. Run "npm install" in the project folder.');
  }

  const options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    tls: smtp.tls,
    connectionTimeout: smtp.connectionTimeoutMs,
    greetingTimeout: smtp.connectionTimeoutMs,
    socketTimeout: smtp.connectionTimeoutMs * 2,
  };
  if (smtp.auth && smtp.auth.user) options.auth = { user: smtp.auth.user, pass: smtp.auth.pass };
  return nodemailer.createTransport(options);
}

function getTransport(cfg) {
  const key = JSON.stringify(cfg.email.smtp);
  if (!transport || key !== transportKey) {
    if (transport && typeof transport.close === 'function') transport.close();
    transport = buildTransport(cfg.email.smtp);
    transportKey = key;
  }
  return transport;
}

/**
 * Send one email.
 *
 * BCC recipients are delivered without appearing in the headers, so they can't
 * see each other or the To/CC list. When there is no To address (BCC-only
 * list), the message is addressed to the sender itself so no recipient address
 * is exposed.
 *
 * @param {{to:string[], cc?:string[], bcc?:string[], subject:string, text:string, html?:string}} message
 * @param {Object} [cfg]
 * @returns {Promise<{messageId:string, accepted:string[], rejected:string[]}>}
 */
async function sendMail(message, cfg = getAlertConfig()) {
  if (!cfg.email.enabled) throw new Error('Email is disabled in alerts.json (email.enabled = false)');
  const to = message.to || [];
  const cc = message.cc || [];
  const bcc = message.bcc || [];
  if (to.length + cc.length + bcc.length === 0) throw new Error('No recipients');

  const info = await getTransport(cfg).sendMail({
    from: cfg.email.from,
    to: to.length > 0 ? to.join(', ') : cfg.email.from,
    cc: cc.length > 0 ? cc.join(', ') : undefined,
    bcc: bcc.length > 0 ? bcc.join(', ') : undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { messageId: info.messageId, accepted: info.accepted || [], rejected: info.rejected || [] };
}

/** Check that the SMTP server accepts our connection and login. */
async function verifyConnection(cfg = getAlertConfig()) {
  return getTransport(cfg).verify();
}

module.exports = { sendMail, verifyConnection };
