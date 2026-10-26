import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteTextPatch, quoteTextValues } from './quote-text-fields.js';

test('all three text fields survive save and reopen mapping', () => {
  const values = { sourcingIncludes: 'Fabric and trims', factoryResponse: '7 days', factoryNotes: 'QC sample included\nShipping extra' };
  assert.deepEqual(quoteTextValues(quoteTextPatch(values)), values);
});

test('clearing a field removes its saved value', () => {
  assert.deepEqual(quoteTextPatch({ sourcingIncludes: ' ', factoryResponse: '', factoryNotes: '' }), {
    sourcing_includes: null, factory_response: null, factory_notes: null,
  });
  assert.deepEqual(quoteTextValues(null), { sourcingIncludes: '', factoryResponse: '', factoryNotes: '' });
});
