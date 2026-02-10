#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2];

function printUsage() {
  console.log(`
Usage: thepopebot <command>

Commands:
  init               Scaffold a new thepopebot project
  setup              Run interactive setup wizard
  setup-telegram     Reconfigure Telegram webhook
  update-workflows   Copy latest workflow files to .github/workflows/
`);
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function init() {
  const cwd = process.cwd();
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');

  console.log('\nScaffolding thepopebot project...\n');

  // Copy template files
  const templateEntries = [
    'operating_system',
    'app',
    'cron',
    'triggers',
    'logs',
    '.pi',
    '.github',
  ];

  for (const entry of templateEntries) {
    const src = path.join(templatesDir, entry);
    const dest = path.join(cwd, entry);
    if (fs.existsSync(src)) {
      copyDirSync(src, dest);
      console.log(`  Created ${entry}/`);
    }
  }

  // Copy individual template files
  const singleFiles = [
    { src: 'next.config.mjs', dest: 'next.config.mjs' },
    { src: '.env.example', dest: '.env.example' },
    { src: '.gitignore', dest: '.gitignore' },
    { src: 'CLAUDE.md', dest: 'CLAUDE.md' },
    { src: 'instrumentation.js', dest: 'instrumentation.js' },
  ];

  for (const file of singleFiles) {
    const src = path.join(templatesDir, file.src);
    const dest = path.join(cwd, file.dest);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log(`  Created ${file.dest}`);
      } else {
        console.log(`  Skipped ${file.dest} (already exists)`);
      }
    }
  }

  // Create package.json if it doesn't exist
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const dirName = path.basename(cwd);
    const pkg = {
      name: dirName,
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        setup: 'thepopebot setup',
        'setup-telegram': 'thepopebot setup-telegram',
        'update-workflows': 'thepopebot update-workflows',
      },
      dependencies: {
        thepopebot: '^1.0.0',
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  Created package.json');
  } else {
    console.log('  Skipped package.json (already exists)');
  }

  // Copy workflows
  updateWorkflows();

  // Create .gitkeep files for empty dirs
  const gitkeepDirs = ['cron', 'triggers', 'logs'];
  for (const dir of gitkeepDirs) {
    const gitkeep = path.join(cwd, dir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) {
      fs.mkdirSync(path.join(cwd, dir), { recursive: true });
      fs.writeFileSync(gitkeep, '');
    }
  }

  console.log('\nDone! Next steps:\n');
  console.log('  1. npm install');
  console.log('  2. npm run setup');
  console.log('  3. npm run dev\n');
}

function updateWorkflows() {
  const cwd = process.cwd();
  const packageDir = path.join(__dirname, '..');
  const workflowsSrc = path.join(packageDir, 'workflows');
  const workflowsDest = path.join(cwd, '.github', 'workflows');

  if (!fs.existsSync(workflowsSrc)) {
    console.log('  No workflow files found in package');
    return;
  }

  fs.mkdirSync(workflowsDest, { recursive: true });

  const files = fs.readdirSync(workflowsSrc).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    fs.copyFileSync(
      path.join(workflowsSrc, file),
      path.join(workflowsDest, file)
    );
    console.log(`  Updated .github/workflows/${file}`);
  }
}

function setup() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup.mjs');
  execSync(`node ${setupScript}`, { stdio: 'inherit', cwd: process.cwd() });
}

function setupTelegram() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup-telegram.mjs');
  execSync(`node ${setupScript}`, { stdio: 'inherit', cwd: process.cwd() });
}

switch (command) {
  case 'init':
    init();
    break;
  case 'setup':
    setup();
    break;
  case 'setup-telegram':
    setupTelegram();
    break;
  case 'update-workflows':
    console.log('\nUpdating workflow files...\n');
    updateWorkflows();
    console.log('\nDone!\n');
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
