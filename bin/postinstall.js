#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// postinstall runs from the package dir inside node_modules.
// The user's project root is two levels up: node_modules/thepopebot/ -> project root
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const templatesDir = path.join(__dirname, '..', 'templates');

// Skip if templates dir doesn't exist (shouldn't happen, but be safe)
if (!fs.existsSync(templatesDir)) process.exit(0);

// Skip if this doesn't look like a user project (no package.json with thepopebot dep)
const pkgPath = path.join(projectRoot, 'package.json');
if (!fs.existsSync(pkgPath)) process.exit(0);
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps || !deps.thepopebot) process.exit(0);
} catch { process.exit(0); }

function walk(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(path.relative(templatesDir, fullPath));
    }
  }
  return files;
}

// Write THEPOPEBOT_VERSION to .env so docker-compose can pin the image tag
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  const ownPkgPath = path.join(__dirname, '..', 'package.json');
  try {
    const ownPkg = JSON.parse(fs.readFileSync(ownPkgPath, 'utf8'));
    const version = ownPkg.version;
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.match(/^THEPOPEBOT_VERSION=.*/m)) {
      envContent = envContent.replace(/^THEPOPEBOT_VERSION=.*/m, `THEPOPEBOT_VERSION=${version}`);
    } else {
      envContent = envContent.trimEnd() + `\nTHEPOPEBOT_VERSION=${version}\n`;
    }
    fs.writeFileSync(envPath, envContent);
  } catch {}
}

const changed = [];
for (const relPath of walk(templatesDir)) {
  const src = path.join(templatesDir, relPath);
  const dest = path.join(projectRoot, relPath);
  if (fs.existsSync(dest)) {
    const srcContent = fs.readFileSync(src);
    const destContent = fs.readFileSync(dest);
    if (!srcContent.equals(destContent)) {
      changed.push(relPath);
    }
  }
}

if (changed.length > 0) {
  console.log('\n  thepopebot: these project files differ from the latest package templates.');
  console.log('  This is normal if you\'ve customized them. If thepopebot was just');
  console.log('  updated, new defaults may be available.\n');
  for (const file of changed) {
    console.log(`    ${file}`);
  }
  console.log('\n  To compare: npx thepopebot diff <file>');
  console.log('  To restore: npx thepopebot reset <file>\n');
}
