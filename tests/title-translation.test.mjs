import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText } from '../api/_translate.js';
test('Chinese title target does not change default English message translation', async () => {
  const fetchBefore = globalThis.fetch;
  const keyBefore = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  let body;
  const respond = (fields) => {
    globalThis.fetch = async (_, options) => { body = JSON.parse(options.body); return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{arguments:JSON.stringify(fields)}}]}}]})}; };
  };
  try {
    respond({source_language:'en',target_language:'zh',translation:'女装／府绸衬衫'});
    const chinese = await translateText('Womenswear / poplin shirts', {targetLanguage:'zh'});
    assert.equal(chinese.translation, '女装／府绸衬衫');
    assert.deepEqual(body.tools[0].function.parameters.properties.target_language.enum,['zh']);
    respond({source_language:'en',target_language:'en',translation:'Original English'});
    const english = await translateText('Original English');
    assert.equal(english.translation,null);
    assert.deepEqual(body.tools[0].function.parameters.properties.target_language.enum,['en']);
    respond({source_language:'en',target_language:'en',translation:'Untranslated'});
    assert.ok((await translateText('Title', {targetLanguage:'zh'})).error);
  } finally {
    globalThis.fetch = fetchBefore;
    if (keyBefore === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = keyBefore;
  }
});
