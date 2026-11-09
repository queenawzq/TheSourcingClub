import test from 'node:test';
import assert from 'node:assert/strict';
import { translateFactoryInterfaceZh as zh } from './factory-interface-zh.mjs';
test('dashboard amounts and counts retain their original values', () => {
  assert.equal(zh('$1,571.00 awaiting brand funding'), '$1,571.00 等待品牌付款');
  assert.equal(zh('2 production steps need an update'), '2 个生产步骤需要更新');
  assert.equal(zh('200 credits'), '200 额度');
});
test('queue counts and calendar labels translate without losing information', () => {
  assert.equal(zh('Active orders (10)'), '进行中订单 (10)');
  assert.equal(zh('November capacity'), '11月 产能');
  assert.equal(zh('Nov 7, 2026'), '2026年11月7日');
});
test('company names and free-form English briefs remain untouched', () => {
  assert.equal(zh('Demo Brand'), 'Demo Brand');
  assert.equal(zh('300 organic cotton shirts, delivery in 8 weeks.'), '300 organic cotton shirts, delivery in 8 weeks.');
});
test('interface actions and payment failures have Chinese copy', () => {
  assert.equal(zh('Purchase credits'), '购买额度');
  assert.equal(zh("Couldn't load your balance. Try again shortly."), '余额加载失败，请稍后重试。');
});
test('empty states and asynchronous interface messages stay in Chinese', () => {
  for (const text of [
    'No saved brands yet. Save a brand from its profile to keep it here.',
    'No saved RFQs yet. Save a request to keep it here.',
    'No open requests match these filters.',
    'No orders match these filters.',
    'Loading your dashboard…',
    'Something went wrong',
    'Billing methods',
  ]) {
    assert.notEqual(zh(text), text);
    assert.match(zh(text), /[\u4e00-\u9fff]/);
  }
  assert.equal(zh('-25 credits'), '-25 额度');
  assert.equal(zh('+500 credits'), '+500 额度');
  assert.equal(zh('Quote sent to Demo Brand'), '报价已发送至 Demo Brand');
});
test('saved English specialty options have Chinese display labels', () => {
  assert.equal(zh('Organic poplin shirts'), '有机棉府绸衬衫');
  assert.equal(zh('Low-MOQ woven tops'), '低起订量梭织上装');
  assert.equal(zh('Small-batch production'), '小批量生产');
  assert.equal(zh('Fit sample support'), '试身样支持');
  assert.equal(zh('Yarn sourcing'), '纱线采购');
  assert.equal(zh('Embroidery / print'), '刺绣／印花');
  for (const name of ['CLO 3D', 'Browzwear', 'Lectra', 'Gerber', 'My custom capability']) assert.equal(zh(name), name);
});
