/**
 * Next.js instrumentation hook for thepopebot.
 * This file is loaded by Next.js on server start when instrumentationHook is enabled.
 *
 * Users should create an instrumentation.js in their project root that imports this:
 *
 *   export { register } from 'thepopebot/instrumentation';
 *
 * Or they can re-export and add their own logic.
 */

let initialized = false;

async function register() {
  // Only run on the server, and only once
  if (typeof window !== 'undefined' || initialized) return;
  initialized = true;

  // Load .env from project root
  require('dotenv').config();

  // Start cron scheduler
  const { loadCrons } = require('../lib/cron');
  loadCrons();

  console.log('thepopebot initialized');
}

module.exports = { register };
