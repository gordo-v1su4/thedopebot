const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const INCLUDE_PATTERN = /\{\{([^}]+\.md)\}\}/g;

/**
 * Render a markdown file, resolving {{filepath}} includes recursively.
 * Referenced file paths resolve relative to the project root.
 * @param {string} filePath - Absolute path to the markdown file
 * @param {string[]} [chain=[]] - Already-resolved file paths (for circular detection)
 * @returns {string} Rendered markdown content
 */
function render_md(filePath, chain = []) {
  const resolved = path.resolve(filePath);

  if (chain.includes(resolved)) {
    const cycle = [...chain, resolved].map((p) => path.relative(paths.PROJECT_ROOT, p)).join(' -> ');
    console.log(`[render_md] Circular include detected: ${cycle}`);
    return '';
  }

  if (!fs.existsSync(resolved)) {
    return '';
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const currentChain = [...chain, resolved];

  return content.replace(INCLUDE_PATTERN, (match, includePath) => {
    const includeResolved = path.resolve(paths.PROJECT_ROOT, includePath.trim());
    if (!fs.existsSync(includeResolved)) {
      return match;
    }
    return render_md(includeResolved, currentChain);
  });
}

module.exports = { render_md };
