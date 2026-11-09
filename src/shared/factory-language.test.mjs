import test from 'node:test';
import assert from 'node:assert/strict';
import { factoryLanguage } from './factory-language.mjs';
test('saved account preference survives missing or stale browser hints', () => {
  assert.equal(factoryLanguage({saved:'zh'}), 'zh');
  assert.equal(factoryLanguage({saved:'en',query:'zh',legacy:'zh'}), 'en');
  assert.equal(factoryLanguage({saved:'zh',query:'en',legacy:'en'}), 'zh');
});
test('existing registrations can inherit Chinese once; unknown values use English', () => {
  assert.equal(factoryLanguage({legacy:'zh'}), 'zh');
  assert.equal(factoryLanguage({query:'zh'}), 'zh');
  assert.equal(factoryLanguage({saved:'invalid',legacy:'invalid'}), 'en');
});
