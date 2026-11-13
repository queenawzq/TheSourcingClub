import test from 'node:test';
import assert from 'node:assert/strict';
import { englishProfileParts } from './profile-translation.mjs';
import { equipmentList, profileSources, translateSources } from '../../shared/profile-translation.mjs';
const original = { orgName: '测试工厂', profile: { legal_name: '中国制造有限公司', intro: '针织工厂', location: '深圳', nearest_port: null }, samples: [{ title: '羊毛衫', caption: '样衣', src: '/photo.jpg' }] };
test('English rendering translates authored fields and preserves the name, legal identity and media', () => {
 const result = englishProfileParts(original, { '测试工厂': 'Test Factory', '针织工厂': 'Knitwear factory', '深圳': 'Shenzhen', '羊毛衫': 'Wool sweater', '样衣': 'Sample' });
 // B5: the company name is the one the brand sees on every other screen.
 assert.equal(result.orgName, '测试工厂');
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

// B12: a Chinese list is several machines, each translated on its own.
test('Key machines split on Chinese commas and translate one by one', () => {
 assert.deepEqual(equipmentList('电脑横机、圆机，平缝机; Overlock'), ['电脑横机', '圆机', '平缝机', 'Overlock']);
 const parts = { profile: { equipment_notes: '电脑横机、圆机' }, samples: [] };
 assert.deepEqual(profileSources(parts), ['电脑横机', '圆机']);
 assert.equal(englishProfileParts(parts, { '电脑横机': 'Computerised flat knitting machine', '圆机': 'Circular knitting machine' }).profile.equipment_notes,
  'Computerised flat knitting machine, Circular knitting machine');
});

// B8: a sample shown under its file name, and the walkthrough, are translated.
test('File-name titles and the walkthrough are in the translated set; the name is not', () => {
 const parts = { orgName: '杭州测试针织', profile: { intro: '针织' }, samples: [{ title: '', file_name: '毛衣样品.jpg', caption: '' }], walkthrough: { title: '车间', caption: '生产线' }, references: [{ title: '英国品牌' }] };
 assert.deepEqual(profileSources(parts), ['针织', '毛衣样品', '车间', '生产线', '英国品牌']);
 // A card asks only for what a card shows.
 assert.deepEqual(profileSources(parts, 'card'), ['针织', '毛衣样品']);
 const shown = englishProfileParts({ ...parts, samples: [{ title: '毛衣样品', caption: '' }] }, { '毛衣样品': 'Sweater sample', '车间': 'Workshop', '生产线': 'Production line' });
 assert.equal(shown.samples[0].title, 'Sweater sample');
 assert.equal(shown.walkthrough.title, 'Workshop');
 assert.equal(shown.walkthrough.caption, 'Production line');
});

const memoryCache = (rows = new Map()) => ({
 rows,
 cacheRead: async (sources) => new Map(sources.filter((source) => rows.has(source)).map((source) => [source, rows.get(source)])),
 cacheWrite: async (written) => written.forEach(({ source, english, translated }) => rows.set(source, { english, translated })),
});

// B2: mixed text the model calls English is not cached as "not translated".
test('A not-translated verdict on Chinese text is neither cached nor trusted from the cache', async () => {
 const mixed = '我们专做 French terry 卫衣和 hoodies';
 const cache = memoryCache(new Map([[mixed, { english: mixed, translated: false }], ['Knitwear', { english: 'Knitwear', translated: false }]]));
 let asked = [];
 const lazy = async (text) => { asked.push(text); return { source_language: 'en', translation: null, error: null }; };
 const first = await translateSources([mixed, 'Knitwear'], { translate: lazy, ...cache });
 assert.deepEqual(asked, [mixed], 'the poisoned row is asked again; the English one is served from the cache');
 assert.deepEqual(first.missing, [mixed]);
 assert.equal(cache.rows.get(mixed).translated, false, 'nothing new written for it');
 asked = [];
 const good = async (text) => ({ source_language: 'zh', translation: 'We specialise in French terry sweatshirts and hoodies', error: null });
 const second = await translateSources([mixed], { translate: good, ...cache });
 assert.equal(second.translations[mixed], 'We specialise in French terry sweatshirts and hoodies');
 assert.deepEqual(cache.rows.get(mixed), { english: 'We specialise in French terry sweatshirts and hoodies', translated: true });
});

// B3: a failure is reported as missing, so the screen can say "Partly".
test('A failed string is missing and not cached; the rest are translated', async () => {
 const cache = memoryCache();
 const translate = async (text) => text === '宁波港' ? { source_language: null, error: 'the model took too long' } : { source_language: 'zh', translation: `EN(${text})`, error: null };
 const result = await translateSources(['针织', '宁波港'], { translate, ...cache });
 assert.deepEqual(result.translations, { '针织': 'EN(针织)' });
 assert.deepEqual(result.missing, ['宁波港']);
 assert.equal(cache.rows.has('宁波港'), false);
});

// B7: strings go out together, not in batches of 6 one after another, and the request ends by its deadline.
test('Strings are translated in parallel within the deadline', async () => {
 const sources = Array.from({ length: 20 }, (_, index) => `第${index}句`);
 let inFlight = 0; let peak = 0;
 const translate = async (text) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((resolve) => setTimeout(resolve, 50)); inFlight--; return { source_language: 'zh', translation: `EN ${text}`, error: null }; };
 const started = Date.now();
 const result = await translateSources(sources, { translate, ...memoryCache(), concurrency: 12 });
 assert.equal(Object.keys(result.translations).length, 20);
 assert.equal(peak, 12);
 assert.ok(Date.now() - started < 200, 'two rounds of 50 ms, not four sequential batches');

 // A model that never answers in time: the request still ends at the deadline, every string missing.
 const slow = (text, { timeoutMs }) => new Promise((resolve) => setTimeout(() => resolve({ source_language: null, error: 'timeout' }), timeoutMs));
 const t0 = Date.now();
 const late = await translateSources(sources.slice(0, 3), { translate: slow, ...memoryCache(), deadlineMs: 300 });
 assert.ok(Date.now() - t0 < 600);
 assert.equal(late.missing.length, 3);
});
