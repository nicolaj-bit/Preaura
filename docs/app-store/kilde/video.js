/* eslint-env node */
// Optager hver scene billede for billede (animationerne styres i tid), og
// syr dem sammen med ffmpeg med overtoninger.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const FPS = 30; const lang = process.argv[2] || 'en';
const scenes = [
  ['bookend.html', `k=intro`, 3.5], ['slides.html', 's=1', 5], ['slides.html', 's=2', 5.5], ['slides.html', 's=3', 5.5],
  ['slides.html', 's=4', 5], ['admin.html', 's=5', 5.5], ['admin.html', 's=6', 5.5], ['bookend.html', 'k=outro', 4.5],
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const dir = `video-${lang}`;
  // ONLY=7: optag kun de nævnte scener igen og genbrug de andre.
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
  if (!only) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    const [file, q, dur] = scenes[i];
    if (only && !only.includes(i) && fs.existsSync(`${dir}/s${i}.mp4`)) { clips.push([`${dir}/s${i}.mp4`, dur]); continue; }
    await p.goto('file://' + path.resolve(file) + `?lang=${lang}&anim=1&${q}`);
    await p.waitForSelector('body[data-ready]', { timeout: 30000 }); await p.waitForTimeout(400);
    const fdir = `${dir}/s${i}`; fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir);
    const n = Math.round(dur * FPS);
    for (let f = 0; f < n; f++) {
      await p.evaluate((t) => { for (const a of document.getAnimations({ subtree: true })) { a.pause(); a.currentTime = t; } }, f * 1000 / FPS);
      await p.screenshot({ path: `${fdir}/${String(f).padStart(4, '0')}.png` });
    }
    const out = `${dir}/s${i}.mp4`;
    execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${fdir}/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 ${out}`);
    fs.rmSync(fdir, { recursive: true }); clips.push([out, dur]); console.log('scene', i);
  }
  await b.close();
  // Overtoninger på 0,6 s mellem scenerne.
  const X = 0.6; let inputs = clips.map(c => `-i ${c[0]}`).join(' '); let filter = ''; let last = '[0:v]'; let offset = 0;
  for (let i = 1; i < clips.length; i++) { offset += clips[i - 1][1] - X; const o = `[v${i}]`; filter += `${last}[${i}:v]xfade=transition=fade:duration=${X}:offset=${offset.toFixed(2)}${o};`; last = o; }
  execSync(`ffmpeg -y -loglevel error ${inputs} -filter_complex "${filter.slice(0, -1)}" -map "${last}" -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart preaura-video-${lang}.mp4`);
  console.log('færdig', `preaura-video-${lang}.mp4`);
})();
