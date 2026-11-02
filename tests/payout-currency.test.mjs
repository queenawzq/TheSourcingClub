import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceCurrency } from '../src/lib/payout-currency.mjs';
test('available USD wins over pending default EUR', () => {
  assert.equal(balanceCurrency({defaultCurrency:'eur',available:[{currency:'eur',amount:0},{currency:'usd',amount:10000}],pending:[{currency:'eur',amount:100}]}),'USD');
});
test('default wins among available funds; pending and empty balances fall back safely', () => {
  assert.equal(balanceCurrency({defaultCurrency:'eur',available:[{currency:'usd',amount:20},{currency:'eur',amount:10}]}),'EUR');
  assert.equal(balanceCurrency({defaultCurrency:'eur',available:[{currency:'usd',amount:-1}],pending:[{currency:'gbp',amount:10}]}),'GBP');
  assert.equal(balanceCurrency({defaultCurrency:'eur'}),'EUR');
  assert.equal(balanceCurrency(null),'USD');
});
