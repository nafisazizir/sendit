// Generates src/data/jawa.json from hand-estimated hold outlines.
// Coordinates below were read off a 1500x2000 preview of each 2000x2666 anchor photo
// and are normalised to 0..1 here. Rough on purpose: the in-app editor is for fixing them.
import { writeFileSync } from 'node:fs';
const DW = 1500, DH = 2000;
const P = (pts) => pts.map(([x, y]) => [+(x / DW).toFixed(4), +(y / DH).toFixed(4)]);
// Approximate a round hold by an octagon from centre + radius
const circ = (cx, cy, r, ry = r) => P(Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry];
}));

const DATE = '2026-10-11';
const faces = [
  { n: 1, angle: 'slab', note: 'Yellow slab with the big yellow volumes. Anchor is angled; retake.' , retake: true },
  { n: 2, angle: 'vertical', note: 'Purple holds, red blob, grey triangle volume on the left.' },
  { n: 3, angle: 'slab', note: 'Sparse face under the JAWA sign; blue holds, purple volumes at the base. Person in anchor; crop or retake.' },
  { n: 4, angle: 'vertical', note: 'Orange horn, green rails, black volume, purple blocks.' },
  { n: 5, angle: 'arete', note: 'Red holds and purple pyramids on the arete. Anchor is angled; retake.', retake: true },
  { n: 6, angle: 'overhang', note: 'Red blobs and the grey volume cluster. Person in angle shot; retake.', retake: true },
  { n: 7, angle: 'overhang', note: 'Grey volume cluster, red hold, green holds, purple volumes at the base.' },
  { n: 8, angle: 'overhang', note: 'Steep face under the JAWA sign: orange, white, red, grey pyramid. Person at right edge; retake.', retake: true },
  { n: 9, angle: 'overhang', note: 'Arete back to face 1: white holds, yellow, black. Person climbing; retake.', retake: true },
];
// Footprint in metres (x, z), counter-clockwise from above: walking order runs left-to-right as you face each wall.
// Pure estimate from the photos and video; measure at the gym.
const footprint = [[0, 0], [-3.5, 0], [-5.5, 1.5], [-6.5, 4.5], [-5, 7], [-3.5, 7.8], [-1.2, 7.5], [0.8, 5.8], [1.2, 2.8]];
const leanFor = { slab: -8, vertical: 0, overhang: 22, arete: 15 };
// Rough crops for anchors that include ceiling or bystanders.
const crops = { 1: [0, 0.08, 1, 0.92], 3: [0.1, 0.12, 0.9, 0.88], 9: [0, 0.1, 0.85, 0.9] };
const geometryFor = (i, angle, n) => ({ from: footprint[i], to: footprint[(i + 1) % footprint.length], height: 4.5, lean: leanFor[angle], ...(crops[n] ? { crop: crops[n] } : {}) });

const angleShots = { 1: 1, 2: 0, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 4, 9: 2 };

const photos = [];
for (const f of faces) {
  const base = `/photos/jawa/jawa-f${f.n}-${DATE}`;
  photos.push({ id: `jawa-f${f.n}-anchor`, faceId: `jawa-f${f.n}`, role: 'anchor', src: `${base}-anchor.jpg`, thumb: `${base}-anchor.thumb.jpg`, width: 2000, height: 2666, shotOn: DATE });
  for (let i = 1; i <= angleShots[f.n]; i++) {
    const landscape = f.n === 4 && i === 2; // IMG_1943 was shot landscape
    photos.push({ id: `jawa-f${f.n}-angle-${i}`, faceId: `jawa-f${f.n}`, role: 'angle', src: `${base}-angle-0${i}.jpg`, thumb: `${base}-angle-0${i}.thumb.jpg`, width: landscape ? 2000 : 2000, height: landscape ? 1500 : 2666, shotOn: DATE });
  }
}

let holds = [];
const H = (id, faceId, colour, type, outline, extra = {}) => holds.push({ id, faceId, colour, type, outline, ...extra });

// ---------- Face 3 (IMG_1940) ----------
H('f3-blue-top', 'jawa-f3', 'blue', 'hold', P([[1285, 640], [1320, 645], [1330, 690], [1300, 700], [1280, 680]]));
H('f3-blue-mid', 'jawa-f3', 'blue', 'hold', circ(1185, 770, 22));
H('f3-blue-low', 'jawa-f3', 'blue', 'hold', P([[1015, 1035], [1050, 1040], [1055, 1080], [1025, 1090], [1010, 1065]]));
H('f3-blue-vol-foot-1', 'jawa-f3', 'blue', 'hold', circ(1190, 1585, 20));
H('f3-blue-vol-foot-2', 'jawa-f3', 'blue', 'hold', circ(1270, 1505, 16));
H('f3-blue-left', 'jawa-f3', 'blue', 'hold', P([[405, 915], [440, 925], [440, 1000], [410, 1025], [385, 1000], [390, 940]]));
H('f3-blue-left-foot-1', 'jawa-f3', 'blue', 'hold', circ(275, 1670, 18));
H('f3-blue-left-foot-2', 'jawa-f3', 'blue', 'hold', circ(790, 1665, 16));
H('f3-blue-left-foot-3', 'jawa-f3', 'blue', 'hold', circ(815, 1665, 14));
H('f3-white', 'jawa-f3', 'white', 'hold', P([[465, 870], [520, 865], [545, 905], [530, 940], [490, 945], [465, 920]]), { note: 'Tag beside it; read at the wall.' });
H('f3-green-crimp', 'jawa-f3', 'green', 'hold', circ(545, 1075, 18, 26), { note: 'Tag below it; read at the wall.' });
H('f3-black-small', 'jawa-f3', 'black', 'hold', circ(1390, 690, 14));
H('f3-orange-top', 'jawa-f3', 'orange', 'hold', P([[1395, 770], [1450, 775], [1455, 850], [1440, 920], [1395, 935], [1340, 900], [1345, 840]]));
H('f3-orange-edge', 'jawa-f3', 'orange', 'hold', circ(1470, 1280, 28, 38));
H('f3-orange-low', 'jawa-f3', 'orange', 'hold', P([[1225, 1355], [1340, 1345], [1355, 1400], [1330, 1430], [1240, 1430], [1215, 1395]]));
H('f3-yellow-1', 'jawa-f3', 'yellow', 'downclimb', circ(1465, 860, 26));
H('f3-vol-purple-left', 'jawa-f3', 'purple', 'volume', P([[155, 1495], [560, 1615], [225, 1800]]));
H('f3-vol-purple-right', 'jawa-f3', 'purple', 'volume', P([[505, 1690], [1345, 1430], [1240, 1850]]));

// ---------- Face 4 (IMG_1942) ----------
H('f4-blue-edge', 'jawa-f4', 'blue', 'hold', P([[0, 575], [35, 570], [65, 590], [50, 615], [10, 620], [0, 610]]), { note: 'On the left edge, beside the arete to face 3.' });
H('f4-black', 'jawa-f4', 'black', 'hold', P([[215, 545], [265, 540], [285, 560], [275, 585], [230, 590], [210, 570]]), { note: 'FINISH tag beside it (readable when zoomed in).' });
H('f4-orange-small', 'jawa-f4', 'orange', 'hold', P([[305, 530], [345, 525], [355, 560], [340, 590], [310, 590], [300, 560]]), { note: 'FINISH tag below it (readable when zoomed in).' });
H('f4-orange-horn', 'jawa-f4', 'orange', 'hold', P([[375, 610], [300, 628], [220, 650], [150, 690], [95, 740], [55, 800], [35, 855], [45, 875], [85, 865], [140, 825], [210, 785], [290, 750], [340, 730], [375, 705]]));
H('f4-orange-low', 'jawa-f4', 'orange', 'hold', P([[185, 1215], [280, 1205], [330, 1230], [335, 1300], [310, 1335], [230, 1340], [180, 1310], [170, 1255]]));
H('f4-yellow-1', 'jawa-f4', 'yellow', 'downclimb', circ(410, 725, 42));
H('f4-yellow-2', 'jawa-f4', 'yellow', 'downclimb', circ(1235, 445, 42));
H('f4-yellow-3', 'jawa-f4', 'yellow', 'downclimb', circ(1350, 545, 42));
H('f4-green-crimp-1', 'jawa-f4', 'green', 'hold', circ(525, 710, 14));
H('f4-green-crimp-top', 'jawa-f4', 'green', 'hold', circ(1040, 455, 13), { note: 'FINISH tag beside it.' });
H('f4-green-rail-1', 'jawa-f4', 'green', 'hold', P([[515, 1245], [560, 1232], [790, 1258], [805, 1290], [770, 1300], [530, 1265]]));
H('f4-green-rail-2', 'jawa-f4', 'green', 'hold', P([[800, 1322], [1120, 1347], [1125, 1375], [805, 1352]]), { note: 'START tag at its right end.' });
H('f4-purple-edge', 'jawa-f4', 'purple', 'hold', P([[1430, 370], [1465, 365], [1485, 400], [1480, 445], [1445, 455], [1425, 420]]), { note: 'FINISH tag beside it, at the right edge next to face 5.' });
H('f4-purple-small', 'jawa-f4', 'purple', 'hold', circ(1375, 1130, 16));
H('f4-vol-black', 'jawa-f4', 'black', 'volume', P([[350, 1378], [665, 1428], [668, 1550], [350, 1525]]));
H('f4-vol-purple-a', 'jawa-f4', 'purple', 'volume', P([[835, 1465], [1150, 1505], [1160, 1660], [1000, 1670], [850, 1620]]));
H('f4-vol-purple-b', 'jawa-f4', 'purple', 'volume', P([[750, 1605], [1040, 1655], [1060, 1830], [830, 1820], [720, 1770]]));
H('f4-vol-purple-c', 'jawa-f4', 'purple', 'volume', P([[1065, 1680], [1400, 1700], [1395, 1830], [1045, 1870]]));

// ---------- Face 8 (IMG_1954) ----------
H('f8-red-top', 'jawa-f8', 'red', 'hold', P([[240, 480], [330, 470], [420, 490], [440, 540], [430, 600], [380, 640], [300, 650], [240, 620], [215, 560]]), { note: 'Tag below it.' });
H('f8-red-small-1', 'jawa-f8', 'red', 'hold', circ(490, 660, 16));
H('f8-red-small-2', 'jawa-f8', 'red', 'hold', circ(540, 625, 16));
H('f8-red-on-block', 'jawa-f8', 'red', 'hold', P([[345, 1240], [420, 1230], [460, 1290], [440, 1360], [370, 1370], [335, 1310]]));
H('f8-red-right', 'jawa-f8', 'red', 'hold', P([[1100, 1290], [1200, 1270], [1270, 1310], [1265, 1380], [1200, 1430], [1120, 1410], [1085, 1350]]), { note: 'Tags beside it.' });
H('f8-red-on-pyramid', 'jawa-f8', 'red', 'hold', circ(865, 940, 14, 20), { note: 'Looks pink: faded red.' });
H('f8-green-top', 'jawa-f8', 'green', 'hold', P([[590, 395], [650, 380], [690, 420], [680, 455], [620, 460], [585, 430]]), { note: 'Tag at its left.' });
H('f8-green-crimp-1', 'jawa-f8', 'green', 'hold', circ(410, 620, 13));
H('f8-green-sloper', 'jawa-f8', 'green', 'hold', P([[770, 650], [820, 635], [860, 680], [870, 760], [850, 800], [800, 790], [765, 720]]));
H('f8-green-ring', 'jawa-f8', 'green', 'hold', P([[790, 1050], [880, 1035], [1000, 1060], [1010, 1120], [950, 1135], [820, 1120], [770, 1080]]), { note: 'Sits on the grey pyramid.' });
H('f8-green-crimp-pyramid', 'jawa-f8', 'green', 'hold', circ(820, 1010, 14));
H('f8-green-small-block', 'jawa-f8', 'green', 'hold', circ(300, 1305, 18));
H('f8-green-a', 'jawa-f8', 'green', 'hold', P([[975, 1350], [1060, 1340], [1090, 1400], [1070, 1450], [1000, 1460], [960, 1400]]), { note: 'START tag beside it.' });
H('f8-green-b', 'jawa-f8', 'green', 'hold', P([[880, 1430], [950, 1420], [965, 1470], [930, 1495], [880, 1480]]));
H('f8-green-small-right', 'jawa-f8', 'green', 'hold', circ(1240, 1200, 12));
H('f8-green-low-1', 'jawa-f8', 'green', 'hold', circ(1130, 1560, 13));
H('f8-green-low-2', 'jawa-f8', 'green', 'hold', circ(1045, 1735, 13));
H('f8-orange-top', 'jawa-f8', 'orange', 'hold', P([[960, 425], [1040, 410], [1080, 440], [1070, 520], [1030, 560], [950, 575], [930, 510]]), { note: 'Tag at its lower left.' });
H('f8-orange-big', 'jawa-f8', 'orange', 'hold', P([[1025, 690], [1080, 680], [1130, 740], [1190, 840], [1180, 900], [1120, 890], [1050, 820], [1015, 750]]));
H('f8-orange-ring', 'jawa-f8', 'orange', 'hold', P([[1230, 800], [1320, 790], [1380, 850], [1375, 960], [1330, 1030], [1240, 1020], [1200, 930], [1195, 840]]));
H('f8-orange-on-pyramid', 'jawa-f8', 'orange', 'hold', P([[655, 1120], [720, 1110], [745, 1160], [715, 1180], [660, 1175]]), { note: 'Tag below it.' });
H('f8-orange-small-right', 'jawa-f8', 'orange', 'hold', circ(1140, 1100, 14));
H('f8-orange-small-block', 'jawa-f8', 'orange', 'hold', circ(440, 1395, 16));
H('f8-white-top', 'jawa-f8', 'white', 'hold', P([[1380, 520], [1460, 510], [1485, 560], [1485, 760], [1460, 830], [1370, 840], [1340, 700], [1350, 600]]));
H('f8-white-mid', 'jawa-f8', 'white', 'hold', P([[1420, 1070], [1470, 1100], [1460, 1180], [1400, 1240], [1330, 1250], [1270, 1240], [1300, 1180], [1370, 1120]]));
H('f8-white-small-block', 'jawa-f8', 'white', 'hold', circ(380, 1410, 14));
H('f8-black-right', 'jawa-f8', 'black', 'hold', circ(1390, 1005, 22, 18));
H('f8-black-low', 'jawa-f8', 'black', 'hold', circ(1300, 1750, 14));
H('f8-yellow-1', 'jawa-f8', 'yellow', 'downclimb', circ(180, 665, 40));
H('f8-yellow-2', 'jawa-f8', 'yellow', 'downclimb', circ(640, 510, 42));
H('f8-yellow-3', 'jawa-f8', 'yellow', 'downclimb', circ(680, 725, 42));
H('f8-yellow-4', 'jawa-f8', 'yellow', 'downclimb', circ(1100, 620, 42));
H('f8-yellow-5', 'jawa-f8', 'yellow', 'downclimb', circ(1020, 880, 42));
H('f8-yellow-6', 'jawa-f8', 'yellow', 'downclimb', circ(180, 915, 42));
H('f8-vol-grey-pyramid', 'jawa-f8', 'grey', 'volume', P([[830, 800], [1135, 1105], [660, 1165]]));
H('f8-vol-grey-block-mid', 'jawa-f8', 'grey', 'volume', P([[500, 1115], [770, 1140], [770, 1330], [605, 1345]]));
H('f8-vol-grey-block-left', 'jawa-f8', 'grey', 'volume', P([[230, 1105], [495, 1130], [500, 1330], [370, 1420], [200, 1330]]));
H('f8-vol-purple-small', 'jawa-f8', 'purple', 'volume', P([[920, 1280], [990, 1270], [1000, 1340], [920, 1340]]));
H('f8-vol-purple-base', 'jawa-f8', 'purple', 'volume', P([[270, 1570], [410, 1550], [640, 1800], [560, 1830], [190, 1820], [160, 1750]]));

const problems = [
  // Cross-face: starts on face 3 and finishes on the blue hold at the left edge of face 4.
  { id: 'jawa-blue-f3-f4', grade: 'blue', holdIds: ['f3-blue-vol-foot-1', 'f3-blue-vol-foot-2', 'f3-blue-low', 'f3-blue-mid', 'f3-blue-top', 'f4-blue-edge'], startHoldIds: ['f3-blue-vol-foot-1'], finishHoldId: 'f4-blue-edge', note: 'Guess from the photos: the blue line on the right of face 3 looks like it rounds the arete to the blue hold on face 4.' },
  { id: 'jawa-blue-f3-left', grade: 'blue', holdIds: ['f3-blue-left-foot-1', 'f3-blue-left-foot-2', 'f3-blue-left-foot-3', 'f3-blue-left'], startHoldIds: ['f3-blue-left-foot-2'], finishHoldId: 'f3-blue-left', note: 'Guess. Might continue onto face 2 around the left arete.' },
  { id: 'jawa-orange-f3', grade: 'orange', holdIds: ['f3-orange-low', 'f3-orange-edge', 'f3-orange-top'], startHoldIds: ['f3-orange-low'], finishHoldId: 'f3-orange-top', note: 'Guess from hold colour and position.' },
  { id: 'jawa-orange-f4', grade: 'orange', holdIds: ['f4-orange-low', 'f4-orange-horn', 'f4-orange-small'], startHoldIds: ['f4-orange-low'], finishHoldId: 'f4-orange-small', note: 'FINISH tag under the small orange hold. Start is a guess.' },
  { id: 'jawa-green-f4', grade: 'green', holdIds: ['f4-green-rail-2', 'f4-green-rail-1', 'f4-green-crimp-1', 'f4-green-crimp-top'], startHoldIds: ['f4-green-rail-2'], finishHoldId: 'f4-green-crimp-top', note: 'START tag on the lower rail, FINISH tag by the top crimp. Fairly confident.' },
  { id: 'jawa-black-f4', grade: 'black', holdIds: ['f4-black'], startHoldIds: [], finishHoldId: 'f4-black', note: 'FINISH tag beside the black hold. The rest of the line is on face 3 or 5 (not labelled yet).' },
  // Cross-face: purple finish on face 4's right edge; the rest of the line is on face 5 (not labelled yet).
  { id: 'jawa-purple-f5-f4', grade: 'purple', holdIds: ['f4-purple-small', 'f4-purple-edge'], startHoldIds: [], finishHoldId: 'f4-purple-edge', note: 'FINISH tag at face 4 right edge. Start and middle are on face 5, which is not labelled yet.' },
  { id: 'jawa-red-f8-a', grade: 'red', holdIds: ['f8-red-on-block', 'f8-red-small-1', 'f8-red-small-2', 'f8-red-top'], startHoldIds: ['f8-red-on-block'], finishHoldId: 'f8-red-top', note: 'Guess. Two red lines share this face; the split between them is unverified.' },
  { id: 'jawa-red-f8-b', grade: 'red', holdIds: ['f8-red-right', 'f8-red-on-pyramid'], startHoldIds: ['f8-red-right'], finishHoldId: null, note: 'Guess. Probably continues onto face 9 or 7.' },
  { id: 'jawa-green-f8', grade: 'green', holdIds: ['f8-green-a', 'f8-green-b', 'f8-green-low-1', 'f8-green-low-2', 'f8-green-ring', 'f8-green-crimp-pyramid', 'f8-green-sloper', 'f8-green-crimp-1', 'f8-green-top'], startHoldIds: ['f8-green-a', 'f8-green-b'], finishHoldId: 'f8-green-top', note: 'START tag by the lower green pair, tag by the top green. Fairly confident.' },
  { id: 'jawa-orange-f8', grade: 'orange', holdIds: ['f8-orange-on-pyramid', 'f8-orange-small-right', 'f8-orange-big', 'f8-orange-ring', 'f8-orange-top'], startHoldIds: ['f8-orange-on-pyramid'], finishHoldId: 'f8-orange-top', note: 'Guess. Tags by the pyramid orange and the top orange.' },
  { id: 'jawa-white-f8', grade: 'white', holdIds: ['f8-white-mid', 'f8-white-top'], startHoldIds: [], finishHoldId: null, note: 'White line on the arete; most of it is on face 9.' },
].map(p => ({ verified: false, ...p }));

const data = {
  version: 1,
  grades: ['yellow', 'blue', 'purple', 'green', 'orange', 'red', 'black', 'white'],
  walls: [{ id: 'jawa', name: 'Jawa', faceIds: faces.map(f => `jawa-f${f.n}`) }],
  faces: faces.map((f, i) => ({ id: `jawa-f${f.n}`, wallId: 'jawa', number: f.n, angle: f.angle, note: f.note, needsRetake: !!f.retake, geometry: geometryFor(i, f.angle, f.n) })),
  sets: [{ id: 'jawa-2026-10', wallId: 'jawa', dateUp: null, dateDown: null, photographedOn: DATE, photos, holds, problems }],
};
writeFileSync(process.argv[2], JSON.stringify(data, null, 2) + '\n');
console.log(`holds ${holds.length}, problems ${problems.length}, photos ${photos.length}`);
