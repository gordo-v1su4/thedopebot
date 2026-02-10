const path = require('path');

/**
 * Next.js config wrapper for thepopebot.
 * Enables instrumentation hook for cron scheduling on server start.
 *
 * Usage in user's next.config.mjs:
 *   import { withThepopebot } from 'thepopebot/config';
 *   export default withThepopebot({});
 *
 * @param {Object} nextConfig - User's Next.js config
 * @returns {Object} Enhanced Next.js config
 */
function withThepopebot(nextConfig = {}) {
  return {
    ...nextConfig,
    experimental: {
      ...nextConfig.experimental,
      instrumentationHook: true,
    },
    // Ensure server-only packages aren't bundled for client
    serverExternalPackages: [
      ...(nextConfig.serverExternalPackages || []),
      'grammy',
      '@grammyjs/parse-mode',
      'node-cron',
      'uuid',
    ],
  };
}

module.exports = { withThepopebot };
