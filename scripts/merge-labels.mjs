// Merge label fragments (model/labels/jawa-fN.json) into src/data/jawa.json.
//   node scripts/merge-labels.mjs model/labels/jawa-f5.json [more...]
// Fragment: { faceId, holds: Hold[], problems: Problem[] }.
// Holds are matched by id (replace). Problems are matched by id: hold lists are unioned so a
// fragment can extend an existing cross-face problem by adding its own face's holds; other
// fields are taken from the fragment only when the existing problem lacks them.
import { readFileSync, writeFileSync } from 'node:fs';

const dataPath = 'src/data/jawa.json';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const set = data.sets[0];
const holdById = new Map(set.holds.map((h) => [h.id, h]));
const problemById = new Map(set.problems.map((p) => [p.id, p]));

for (const path of process.argv.slice(2)) {
  const frag = JSON.parse(readFileSync(path, 'utf8'));
  let nh = 0, np = 0, xp = 0;
  for (const h of frag.holds) {
    if (!h.id || !h.faceId || !Array.isArray(h.outline) || h.outline.length < 3) throw new Error(`${path}: bad hold ${JSON.stringify(h).slice(0, 80)}`);
    if (h.faceId !== frag.faceId) throw new Error(`${path}: hold ${h.id} is on ${h.faceId}, fragment is ${frag.faceId}`);
    if (holdById.has(h.id)) Object.assign(holdById.get(h.id), h);
    else {
      set.holds.push(h);
      holdById.set(h.id, h);
    }
    nh++;
  }
  for (const p of frag.problems ?? []) {
    for (const hid of p.holdIds) if (!holdById.has(hid)) throw new Error(`${path}: problem ${p.id} references unknown hold ${hid}`);
    const existing = problemById.get(p.id);
    if (existing) {
      existing.holdIds = [...new Set([...existing.holdIds, ...p.holdIds])];
      existing.startHoldIds = [...new Set([...existing.startHoldIds, ...(p.startHoldIds ?? [])])];
      if (!existing.finishHoldId && p.finishHoldId) existing.finishHoldId = p.finishHoldId;
      if (!existing.note && p.note) existing.note = p.note;
      else if (p.note && existing.note && !existing.note.includes(p.note)) existing.note += ` · ${p.note}`;
      xp++;
    } else {
      const fresh = { verified: false, ...p };
      set.problems.push(fresh);
      problemById.set(p.id, fresh); // the same object, so a later fragment extends what is in the set
      np++;
    }
  }
  console.log(`${path}: ${nh} holds, ${np} new problems, ${xp} extended`);
}
// a hold may belong to at most one problem (volumes aside) — report violations rather than fix them
const seen = new Map();
for (const p of set.problems) for (const hid of p.holdIds) {
  if (seen.has(hid) && holdById.get(hid)?.type !== 'volume') console.warn(`warning: hold ${hid} is in both ${seen.get(hid)} and ${p.id}`);
  seen.set(hid, p.id);
}
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log(`total: ${set.holds.length} holds, ${set.problems.length} problems`);
