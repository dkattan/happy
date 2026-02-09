const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const extRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(extRoot, '.vsix-tmp');
const outPath = path.join(extRoot, 'dist', 'happy-vscode-extension.vsix');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
ensureDir(tmpRoot);
ensureDir(path.dirname(outPath));

copyFile(path.join(extRoot, 'package.json'), path.join(tmpRoot, 'package.json'));
copyFile(path.join(extRoot, 'README.md'), path.join(tmpRoot, 'README.md'));
copyDir(path.join(extRoot, 'dist'), path.join(tmpRoot, 'dist'));
copyDir(path.join(extRoot, 'node_modules', 'sql.js'), path.join(tmpRoot, 'node_modules', 'sql.js'));

execSync(`npx -y @vscode/vsce package -o "${outPath}"`, { cwd: tmpRoot, stdio: 'inherit' });

fs.rmSync(tmpRoot, { recursive: true, force: true });
