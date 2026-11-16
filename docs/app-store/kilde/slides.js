const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
  fs.mkdirSync('ud/da',{recursive:true}); fs.mkdirSync('ud/en',{recursive:true});
  for (const lang of ['da','en']) for (const s of (process.argv[2]||'1,2,3,4').split(',')) {
    await p.goto('file://'+path.resolve('slides.html')+`?lang=${lang}&s=${s}`); await p.waitForSelector('body[data-ready]',{timeout:20000}); await p.waitForTimeout(300);
    await p.screenshot({path:`ud/${lang}/${s}.png`}); console.log(lang,s); }
  await b.close(); })();
