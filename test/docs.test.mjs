import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [...readdirSync(root).filter(name => name.endsWith('.md')),
  ...readdirSync(resolve(root, 'docs')).filter(name => name.endsWith('.md')).map(name => 'docs/' + name)];
function headings(text) {
  let fenced = false;
  const counts = new Map(), anchors = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    const heading = !fenced && /^#{1,6} (.+)$/.exec(line);
    if (!heading) continue;
    const slug = heading[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
    const count = counts.get(slug) || 0;
    anchors.add(slug + (count ? '-' + count : '')); counts.set(slug, count + 1);
  }
  return anchors;
}

test('all local documentation links and section anchors resolve in the distributed bundle', () => {
  const failures = [];
  for (const name of files) {
    const path = resolve(root, name), text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target)) continue;
      const [file, anchor] = target.split('#');
      const destination = file ? resolve(dirname(path), decodeURIComponent(file)) : path;
      if (relative(root, destination).startsWith('..') || !existsSync(destination)) { failures.push(name + ': ' + target); continue; }
      if (anchor && destination.endsWith('.md') && !headings(readFileSync(destination, 'utf8')).has(decodeURIComponent(anchor))) failures.push(name + ': ' + target);
    }
  }
  assert.deepEqual(failures, []);
});
