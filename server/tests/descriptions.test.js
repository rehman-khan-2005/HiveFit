// Description cleaning.
//
// This had a real bug with real consequences: entities were decoded after tags
// were stripped, so the double-escaped markup Greenhouse and The Muse serve
// survived into the text the analysis reads. 268 stored postings carried about
// 1,300 characters of markup each, and every "div", "class", "quot" and "span"
// in them entered the TF-IDF vocabulary — which is fitted across the whole
// corpus, so the markup in those rows moved the term weights used to score
// every other posting too.

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripHtml } from '../src/jobs/shared.js';

test('plain markup becomes text', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('double-escaped markup is removed, not decoded into the text', () => {
  // The Greenhouse shape. Decoding once and stripping once turns the entities
  // into tags only after the tag stripper has run.
  const input = '&lt;div class=&quot;content-intro&quot;&gt;Build &amp; ship&lt;/div&gt;';
  assert.equal(stripHtml(input), 'Build & ship');
});

test('triple escaping is still removed', () => {
  assert.equal(stripHtml('&amp;lt;p&amp;gt;Triple&amp;lt;/p&amp;gt;'), 'Triple');
});

test('no markup token survives into the vocabulary', () => {
  const input = '&lt;span style=&quot;font-size: 10pt;&quot;&gt;Python&lt;/span&gt;'
    + '&lt;p data-renderer-start-pos=&quot;1648&quot;&gt;Go&lt;/p&gt;';
  const text = stripHtml(input);
  for (const token of ['span', 'style', 'font', 'data', 'renderer', 'quot', 'pos', '1648']) {
    assert.ok(!text.toLowerCase().includes(token), `"${token}" is gone`);
  }
  assert.match(text, /Python/);
  assert.match(text, /Go/);
});

test('script and style contents are dropped, not inlined as prose', () => {
  assert.equal(stripHtml('<script>var x = 1;</script>Real text'), 'Real text');
  assert.equal(stripHtml('<style>.a{color:red}</style>Real text'), 'Real text');
});

test('block boundaries become line breaks, so requirements stay separate', () => {
  // The bullet parser works on lines. Collapsing a list to one line would
  // merge every requirement into a single run of text.
  assert.equal(stripHtml('<li>One</li><li>Two</li>'), 'One\nTwo');
  assert.equal(stripHtml('First<br>Second'), 'First\nSecond');
});

test('named, decimal and hex entities all decode', () => {
  assert.equal(stripHtml('A&nbsp;B'), 'A B');
  assert.equal(stripHtml('it&#39;s'), "it's");
  assert.equal(stripHtml('it&#x27;s'), "it's");
  assert.equal(stripHtml('A &mdash; B'), 'A — B');
});

test('an unknown entity does not leave its own name in the text', () => {
  // "&zzz;" decoding to "zzz" would put a junk token in the vocabulary.
  assert.equal(stripHtml('A&zzz;B'), 'A B');
});

test('whitespace is collapsed without losing paragraph structure', () => {
  assert.equal(stripHtml('<p>One</p>\n\n\n\n<p>Two</p>'), 'One\n\nTwo');
});

test('absent and non-string input are handled', () => {
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(42), '42');
});

test('text with no markup is returned unchanged', () => {
  const plain = 'Software Engineer\n\nWe use Python and Go.';
  assert.equal(stripHtml(plain), plain);
});
