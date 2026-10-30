'use strict';

/**
 * Email service — sends mail through the SMTP server configured in the
 * environment (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).
 * Without SMTP_HOST, email is switched off and isConfigured() is false.
 */

const nodemailer = require('nodemailer');

let transporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter() {
  if (!isConfigured()) throw new Error('Email is not configured (SMTP_HOST is not set)');
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is TLS from the start; other ports (587) upgrade with STARTTLS,
      // which is required so the password never travels in clear text
      secure: port === 465,
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });
  }
  return transporter;
}

/**
 * Connect and log in to the SMTP server without sending anything.
 *
 * @returns {Promise<true>}
 */
function verify() {
  return getTransporter().verify();
}

/**
 * @param {{ to: string[], subject: string, text: string, html?: string }} message
 * @returns {Promise<Object>} nodemailer's send info
 */
function sendMail({ to, subject, text, html }) {
  return getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: to.join(', '),
    subject,
    text,
    html,
  });
}

module.exports = {
  isConfigured,
  verify,
  sendMail,
};
