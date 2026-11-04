import test from 'node:test';
import assert from 'node:assert/strict';
import { englishProfileParts } from './profile-translation.mjs';
const original = { orgName: '测试工厂', profile: { legal_name: '中国制造有限公司', intro: '针织工厂', location: '深圳', nearest_port: null }, samples: [{ title: '羊毛衫', caption: '样衣', src: '/photo.jpg' }] };
test('English rendering translates authored fields and preserves legal identity and media', () => {
 const result = englishProfileParts(original, { '测试工厂': 'Test Factory', '针织工厂': 'Knitwear factory', '深圳': 'Shenzhen', '羊毛衫': 'Wool sweater', '样衣': 'Sample' });
 assert.equal(result.orgName, 'Test Factory');
 assert.equal(result.profile.intro, 'Knitwear factory');
 assert.equal(result.profile.location, 'Shenzhen');
 assert.equal(result.samples[0].title, 'Wool sweater');
 assert.equal(result.samples[0].caption, 'Sample');
 assert.equal(result.profile.legal_name, original.profile.legal_name);
 assert.equal(result.samples[0].src, '/photo.jpg');
 assert.equal(original.profile.intro, '针织工厂');
});
test('Unavailable translations preserve the original without mutation', () => {
 const result = englishProfileParts(original, {});
 assert.equal(result.profile.intro, original.profile.intro);
 assert.equal(result.profile.nearest_port, null);
 assert.deepEqual(result.samples, original.samples);
});
