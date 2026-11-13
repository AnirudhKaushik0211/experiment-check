'use strict';
// SPEC 10.1 package row: packagePublic into a temporary folder outside the project, generic patterns only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { packagePublic } = require('../scripts/package-public.cjs');
const { readZip } = require('../scripts/zip.cjs');

const ROOT = path.resolve(__dirname, '..');

// Independent statement of the SPEC 11.1 allow-list.
function expectedFiles(root) {
  const out = [];
  for (const f of ['index.html', 'README.md', 'LICENSE', '.gitignore', '.nojekyll', 'package.json']) {
    if (fs.existsSync(path.join(root, f))) out.push(f);
  }
  const walk = (dir, rel, ext) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + '/' + e.name, ext);
      else if (e.name.endsWith(ext)) out.push(rel + '/' + e.name);
    }
  };
  const top = (dir, re) => {
    if (!fs.existsSync(path.join(root, dir))) return;
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) if (e.isFile() && re.test(e.name)) out.push(dir + '/' + e.name);
  };
  walk(path.join(root, 'css'), 'css', '.css');
  walk(path.join(root, 'js'), 'js', '.js');
  top('docs', /\.(md|png)$/);
  top('test', /\.test\.cjs$/);
  top('scripts', /\.cjs$/);
  return out.sort();
}

function filesUnder(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ec-pkg-')); }

test('packagePublic (generic-only) builds the folder and a matching zip', () => {
  const base = tmpDir();
  const out = path.join(base, 'experiment-check-public');
  try {
    const r = packagePublic({ out, genericOnly: true });
    assert.strictEqual(r.ok, true, r.lines.join('\n'));
    assert.deepStrictEqual(r.hits, []);
    const want = expectedFiles(ROOT);
    assert.deepStrictEqual(r.files, want);
    assert.deepStrictEqual(filesUnder(out), want);
    assert.ok(fs.existsSync(out + '.zip'));
    const entries = readZip(fs.readFileSync(out + '.zip'));
    assert.deepStrictEqual(entries.map((e) => e.name), want.map((f) => 'experiment-check-public/' + f));
    assert.ok(entries.every((e) => !e.name.includes('\\')), 'no backslashes');
    for (const e of entries) {
      const rel = e.name.slice('experiment-check-public/'.length);
      assert.ok(e.data.equals(fs.readFileSync(path.join(out, ...rel.split('/')))), rel);
    }
    for (const f of want) {
      assert.ok(!/(^|\/)dist\//.test(f) && !f.endsWith('.denylist.local') && !f.endsWith('.log'), f);
    }
    assert.ok(r.lines.includes('OK: ' + out));
    assert.ok(r.lines.includes('OK: ' + out + '.zip'));
    // A second run over a previous package replaces it.
    assert.strictEqual(packagePublic({ out, genericOnly: true }).ok, true);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a planted deny-list term in a copy of the project fails the package and removes the output', () => {
  const base = tmpDir();
  const copy = path.join(base, 'project');
  const out = path.join(base, 'out', 'experiment-check-public');
  try {
    fs.cpSync(ROOT, copy, {
      recursive: true,
      filter: (src) => { const r = path.relative(ROOT, src).split(path.sep); return r[0] !== 'dist' && r[0] !== '.denylist.local'; }
    });
    fs.writeFileSync(path.join(copy, 'docs', 'planted.md'), 'Contact: ' + 'someone' + '@' + 'example.com' + '\n');
    const r = packagePublic({ root: copy, out, genericOnly: true });
    assert.strictEqual(r.ok, false);
    assert.ok(r.hits.length >= 2, 'hit in the folder and in the zip');
    assert.ok(r.hits.some((h) => h.startsWith('docs/planted.md:1')));
    assert.ok(r.hits.every((h) => !h.includes('@')), 'locations only');
    assert.ok(r.lines.includes('REFUSED: package removed.'));
    assert.ok(!fs.existsSync(out));
    assert.ok(!fs.existsSync(out + '.zip'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('refuses an --out that contains the project or is not a previous package', () => {
  const r1 = packagePublic({ out: path.dirname(ROOT), genericOnly: true });
  assert.strictEqual(r1.ok, false);
  const base = tmpDir();
  try {
    fs.writeFileSync(path.join(base, 'keep.txt'), 'x');
    const r2 = packagePublic({ out: base, genericOnly: true });
    assert.strictEqual(r2.ok, false);
    assert.ok(fs.existsSync(path.join(base, 'keep.txt')), 'an unrelated folder is never touched');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
