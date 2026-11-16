/* eslint-env node */
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport:{width:1200,height:1200} });
  for (const v of ['dark','light']) { await p.goto('file://'+path.resolve('icon.html')+'?v='+v); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300); await p.screenshot({path:`preaura-ikon-${v}.png`}); console.log(v); }
  await b.close(); })();
