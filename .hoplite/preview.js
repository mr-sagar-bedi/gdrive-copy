const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const hogan = require('hogan.js');

execFileSync('npm', ['run', 'webpack:dev'], { stdio: 'inherit' });
const output = path.join(__dirname, 'preview');
fs.mkdirSync(output, { recursive: true });
const partials = {};
['header', 'header-icon', 'footer'].forEach(name => {
  partials[name] = fs.readFileSync(`src/templates/${name}.html`, 'utf8');
});
const template = hogan.compile(
  fs.readFileSync('src/templates/index.html', 'utf8')
);
fs.writeFileSync(
  path.join(output, 'index.html'),
  template.render({ isProd: false }, partials)
);
fs.copyFileSync('dist/bundle.js', path.join(output, 'bundle.js'));
fs.copyFileSync('dist/css.html', path.join(output, 'css.css'));
const server = spawn(
  'python3',
  ['-m', 'http.server', '3000', '--bind', '0.0.0.0', '--directory', output],
  { stdio: 'inherit' }
);
['SIGTERM', 'SIGINT'].forEach(signal =>
  process.on(signal, () => server.kill(signal))
);
server.on('exit', code => process.exit(code || 0));
