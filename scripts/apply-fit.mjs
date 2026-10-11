// Merge the output of scripts/fit-faces.py into src/data/jawa.json (faces[].geometry).
//   node scripts/apply-fit.mjs model/faces-fit.json
// Keeps any face the fit could not solve untouched, so a partial fit still improves the block.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , fitPath = 'model/faces-fit.json', dataPath = 'src/data/jawa.json'] = process.argv;
const fit = JSON.parse(readFileSync(fitPath, 'utf8'));
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

let applied = 0;
for (const face of data.faces) {
  const g = fit.geometry?.[face.id];
  if (!g) continue;
  const prev = face.geometry ?? {};
  face.geometry = {
    from: g.from_,
    to: g.to,
    height: g.height,
    lean: g.lean,
    ...(g.quad ? { quad: g.quad } : prev.crop ? { crop: prev.crop } : {}),
    source: 'sfm',
  };
  applied++;
}
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log(`applied geometry to ${applied}/${data.faces.length} faces (scale ${fit.scale_m_per_unit?.toFixed(4)} m/unit, height ${fit.height_m} m)`);
for (const n of fit.notes ?? []) console.log('note:', n);
