# Translation speed: measurements (local database, Nov 19)

## The cause

Browse sends every listed vendor's card text in one request. Place names such as "Porto, Portugal" and "Izmir, Türkiye" come back from the model unchanged (it reads them as Portuguese or Turkish). That was counted as a failure, so they were never cached and went to the model again on every load. Every Browse load waited for 8 model calls. Company names were already cached.

## The card request (`/api/profile-translation`, 22 vendors)

| | Load 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Before | 2758 ms (10 incomplete) | 2048 | 1854 | 1774 | | |
| After | 1158 ms (caches the place names) | 41 | 27 | 13 | 13 | 11 |

## Time to English on the page (ms, 1440 px, from opening the page)

| Page | Before (5 loads) | After (5 loads) |
|---|---|---|
| Browse | 1850, 1810, 1625, 1753, 1768 | 1110 (first, caches), 226, 198, 148, 132 |
| Saved | 195, 132, 132, 116, 116 | 132, 115, 117, 116, 116 |
| Vendor page | 1656 (first), 157, 198, 183, 232 | 132, 133, 148, 216, 165 |

Saved holds only one vendor, already cached in both runs. The vendor page's first load before was its first-ever translation; after, it was already cached.

## Thinking off: 12 real translations, before and after (ms and words)

No measurable difference in time: a forced tool call does not think (as the review-note route already says). Same meaning in every case.

| Context | Text | Before | After | Before ms | After ms |
|---|---|---|---|---|---|
| factory profile | 我们是位于宁波的针织服装工厂，拥有8条生产线和160名员工，专做圆机针织T恤、卫衣、婴童连体衣和横机毛衫。最低起订量200件/款，打样周期7天，大货周期35天。 | We are a knitwear garment factory located in Ningbo, with 8 production lines and 160 employees. We specialise in circular-knit T-shirts, sweatshirts, baby/toddler one-piece garments and flat-knit jumpers. MOQ is 200 pieces per style, sampling lead time is 7 days, and bulk production lead time is 35 days. | We are a knitwear garment factory located in Ningbo, with 8 production lines and 160 employees. We specialize in circular-knit T-shirts, sweatshirts, baby and toddler one-piece garments, and flat-knit sweaters. MOQ is 200 pcs per style, sampling lead time is 7 days, and bulk production lead time is 35 days. | 1266 | 1275 |
| factory profile | 浙江省宁波市鄞州区 | Yinzhou District, Ningbo City, Zhejiang Province | Yinzhou District, Ningbo City, Zhejiang Province | 813 | 816 |
| factory profile | 有机棉罗纹婴儿连体衣 | Organic cotton rib baby onesie | Organic cotton rib baby onesie | 773 | 767 |
| factory profile | Porto, Portugal | (nothing to translate into) | (nothing to translate into) | 807 | 714 |
| company name | 宁波晨织服饰有限公司 | Ningbo Chenzhi Apparel Co., Ltd. | Ningbo Chenzhi Apparel Co., Ltd. | 775 | 1082 |
| company name | 广元盛远国际贸易有限公司 | Guangyuan Shengyuan International Trading Co., Ltd. | Guangyuan Shengyuan International Trading Co., Ltd. | 827 | 796 |
| message | 试身样已完成，领口和口袋位置已按工艺单核对。请查看照片。 | The fit sample is completed, and the neckline and pocket positions have been checked against the tech pack. Please check the photos. | The fit sample is completed, and the neckline and pocket positions have been checked against the tech pack. Please check the photos. | 783 | 820 |
| message | 确认样衣后两周内可以开始生产。报价含一次试身样和产前样，FOB宁波。面料为GOTS认证有机棉，GSM 180。 | Production can start within two weeks after the sample garment is confirmed. The quotation includes one fit sample and a PP sample, FOB Ningbo. The fabric is GOTS-certified organic cotton, GSM 180. | Production can start within two weeks after the sample is confirmed. The quotation includes one fit sample and a PP sample, FOB Ningbo. The fabric is GOTS-certified organic cotton, GSM 180. | 1051 | 935 |
| message | Can you send the lab dip for Pantone 19-4052 by Friday? | (English: unchanged) | (English: unchanged) | 808 | 801 |
| message | Hola, ¿pueden enviar la muestra PP antes del 12 de diciembre? | (nothing to translate into) | (nothing to translate into) | 766 | 819 |
| to Chinese | We need 300 units in sand-washed silk, sample before bulk. | 我们需要300件砂洗真丝面料的产品，大货前先做样。 | 我们需要300件砂洗真丝面料的产品，大货前先做样品。 | 770 | 767 |
| to Chinese | Please confirm the PP sample date and the FOB price. | 请确认产前样的日期和 FOB 价格。 | 请确认产前样日期和FOB价格。 | 642 | 681 |

Older, not changed here: a Spanish message ("Hola, ¿pueden enviar la muestra PP…") comes back untranslated three times out of three, before and after.
