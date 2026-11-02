// The home: geometry, materials, sunrise lighting and the view outside.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Read off Everly's sketch, a top view with east on the left of the page (so the
// top of the page is south). Plan coordinates, in metres: x runs west from the
// east wall (0 to 9.4), z runs north from the south wall (0 to 13.6). Everything
// is built in these, inside a group shifted so the home sits on the world origin.
//   top of the page (south) : living room, kitchen and dining, one open space
//   middle left             : the main bedroom; a short hallway beside the
//                             "not in" block joins it to the living room
//   middle right            : the big bathroom: vanity, toilet room, shower, two walk-in closets
//   bottom right (north)    : the kids' room, through a little hall from door 5
// The "not in" and "not" blocks are left out: open air, like a courtyard.
const H = 2.7, T = 0.12, DOOR_H = 2.1, Y0 = 0.85, Y1 = 2.25;
const XE = 9.4, ZK = 13.6;                 // the west wall; the kids' room's north wall
const XB = 5.0;                            // bedroom | bathroom, hallway | dining, hall | kids' room
const XH = 3.75, ZL = 4.0, ZM = 5.4;       // hallway's east wall; living room's north wall; bedroom's south wall
const ZN = 10.0, XH2 = 3.8, ZH2 = 11.4;    // bedroom's north wall; the little hall to the kids' room
const CX = XE / 2, CZ = ZK / 2;
// east windows: [z from, z to, sill, head]
const LIVING_WIN = [1.3, 2.7, 0.9, 2.25], BED_WIN = [7.15, 8.25, 1.2, 2.3], KIDS_WIN = [12.05, 13.15, 0.85, 2.25];
// doorways: [from, to] along their wall
const HALL_DOOR = [3.95, 4.8], EN_SUITE = [6.7, 7.6], DOOR5 = [3.95, 4.8], KIDS_DOOR = [10.25, 11.15];

// The sun moves: buildScene().setSun(minutes) places it. Sunrise is minute 0.
// It climbs the way it does at Tuscany's latitude: about 0.18 degrees a minute
// upwards while sliding 0.17 degrees a minute to the south.
const sunDir = new THREE.Vector3(-1, 0, 0);
export const SUNRISE = { start: -1, end: 45 };   // minutes covered by the animation

// [camera, target] in world coordinates (plan minus the centre)
const w = (x, y, z) => [x - CX, y, z - CZ];
export const views = {
  overview: [[1.2, 13.5, 10.8], [0, 0, 0.4]],
  living:   [w(4.7, 1.6, 3.6), w(1.4, 0.7, 1.2)],
  bedroom:  [w(3.5, 1.65, 9.65), w(0.7, 0.8, 7.0)],
  bathroom: [w(5.3, 1.75, 8.15), w(7.4, 0.95, 6.25)],
  kids:     [w(5.5, 1.6, 13.2), w(8.6, 0.9, 10.9)],
  plan:     [[0, 19, 0.001], [0, 0, 0]],
};

export function buildScene(scene, renderer) {
  const hideFromAO = [];
  const root = new THREE.Group();          // plan coordinates live in here
  root.position.set(-CX, 0, -CZ);
  scene.add(root);


  // ---------- helpers ----------
  let seed = 7;
  const rand = () => { // small deterministic generator so the room looks the same on every load
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // Materials are shared wherever colour, texture and options match, which lets
  // the final merge step fold many small meshes into a single draw call.
  const matCache = new Map();
  const mat = (color, map, extra) => {
    const key = `${color}|${map ? map.uuid : ''}|${extra ? JSON.stringify(extra) : ''}`;
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...(map && { map }), ...extra }));
    return matCache.get(key);
  };

  function add(geo, material, x, y, z, parent = root) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  // Boxes get softly rounded edges so they catch a highlight instead of looking razor-cut.
  const box = (w, h, d, material, x, y, z, parent) => {
    const m = Math.min(w, h, d);
    const geo = m >= 0.02 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.012, m * 0.25)) : new THREE.BoxGeometry(w, h, d);
    return add(geo, material, x, y, z, parent);
  };
  const ball = (r, material, x, y, z, parent, sx = 1, sy = 1, sz = 1) => {
    const m = add(new THREE.SphereGeometry(r, 28, 18), material, x, y, z, parent);
    m.scale.set(sx, sy, sz);
    return m;
  };
  const cyl = (rTop, rBottom, h, material, x, y, z, parent) =>
    add(new THREE.CylinderGeometry(rTop, rBottom, h, 28), material, x, y, z, parent);
  const group = (x, y, z, rotY = 0, parent = root) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    parent.add(g);
    return g;
  };
  // A flat picture that hangs on a wall and, like the wall, is only visible from inside.
  const flat = (w, h, material, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // Many copies of one small shape in a single draw call.
  function scatter(geo, material, matrices, parent) {
    const im = new THREE.InstancedMesh(geo, material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = im.receiveShadow = true;
    parent.add(im);
    return im;
  }

  // Rounded-corner slab lying flat; (x, y, z) is the centre of its underside.
  // mats = [top/bottom material, side material]
  function slab(w, h, d, r, mats, x, y, z, parent) {
    const s = new THREE.Shape(), a = -w / 2, b = -d / 2;
    s.moveTo(a + r, b); s.lineTo(a + w - r, b); s.quadraticCurveTo(a + w, b, a + w, b + r);
    s.lineTo(a + w, b + d - r); s.quadraticCurveTo(a + w, b + d, a + w - r, b + d);
    s.lineTo(a + r, b + d); s.quadraticCurveTo(a, b + d, a, b + d - r);
    s.lineTo(a, b + r); s.quadraticCurveTo(a, b, a + r, b);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 12 });
    geo.rotateX(-Math.PI / 2);
    return add(geo, mats, x, y, z, parent);
  }

  // A pillow: pinched to nothing along its seam, plump in the middle, corners that stick out a little.
  function pillowGeo(w, d, t, n = 28) {
    const pos = [], uv = [], idx = [];
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const u = -1 + 2 * i / n, v = -1 + 2 * j / n;
        const plump = Math.pow(Math.max(0, (1 - u * u) * (1 - v * v)), 0.3);
        const crease = 0.004 * Math.sin(u * 9 + v * 3) * Math.sin(v * 7 - u * 2);
        pos.push(u * w / 2 * (1 - 0.07 * (1 - v * v)), side * (t / 2) * plump * (1 + crease / t * 1.5), v * d / 2 * (1 - 0.07 * (1 - u * u)));
        uv.push((u + 1) / 2, (v + 1) / 2);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, e = c + 1;
        side > 0 ? idx.push(a, c, b, b, c, e) : idx.push(a, b, c, b, e, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Fluff. Soft things get a coat of fine fibres drawn as stacked shells: each
  // shell is the surface pushed out a little further, and the shader keeps only
  // the dots where a fibre is still that long. One draw call per material.
  const furCache = new Map();
  function furMaterial(base, curl, shade) {
    const key = base.uuid + '|' + curl + '|' + shade;
    if (furCache.has(key)) return furCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color: base.color, roughness: 1, alphaTest: 0.5, alphaToCoverage: true, ...(base.map && { map: base.map }) });
    m.onBeforeCompile = sh => {
      sh.uniforms.uCurl = { value: curl };
      sh.uniforms.uShade = { value: shade };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aShell;\nattribute vec2 furUv;\nvarying float vShell;\nvarying vec2 vFurUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShell = aShell;\nvFurUv = furUv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vShell; varying vec2 vFurUv; uniform float uCurl, uShade;
          float furHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <alphatest_fragment>', `
          vec2 fu = vFurUv + uCurl * vShell * vec2(sin(vFurUv.y * 1.7), cos(vFurUv.x * 1.7));   // curl the fibre as it grows
          vec2 cell = floor(fu);
          float len = 0.35 + 0.65 * furHash(cell);                                              // each fibre its own length
          vec2 root = (vec2(furHash(cell + 7.3), furHash(cell + 19.1)) - 0.5) * 0.4;
          float r = length(fract(fu) - 0.5 - root) * 2.0;
          diffuseColor.a = (1.0 - vShell / len) - r * 0.9 + 0.5;                                // tapers to a tip
          diffuseColor.rgb *= mix(uShade, 1.06, vShell);                                           // darker down in the pile
          #include <alphatest_fragment>`);
    };
    m.customProgramCacheKey = () => 'fur';
    furCache.set(key, m);
    return m;
  }
  // uvSize = [metres per unit of u, metres per unit of v]; guessed from the bounding box when omitted.
  function fluff(meshes, { length, layers, strand, curl = 0, droop = 0.25, shade = 0.5, uvSize }) {
    const byMat = new Map();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const src = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
      src.computeBoundingBox();
      const size = src.boundingBox.getSize(new THREE.Vector3());
      const us = (uvSize ? uvSize[0] : Math.PI * Math.max(size.x, size.z)) / strand;
      const vs = (uvSize ? uvSize[1] : Math.PI / 2 * Math.max(size.y, Math.min(size.x, size.z))) / strand;
      const P = src.attributes.position, N = src.attributes.normal, UV = src.attributes.uv, n = P.count;
      if (!byMat.has(mesh.material)) byMat.set(mesh.material, []);
      for (let i = 1; i <= layers; i++) {
        const t = i / layers, out = length * t, sag = droop * length * t * t;
        const pos = new Float32Array(n * 3), fu = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) {
          pos[3 * k] = P.getX(k) + N.getX(k) * out;
          pos[3 * k + 1] = P.getY(k) + N.getY(k) * out - sag;
          pos[3 * k + 2] = P.getZ(k) + N.getZ(k) * out;
          fu[2 * k] = UV.getX(k) * us; fu[2 * k + 1] = UV.getY(k) * vs;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', N.clone());
        g.setAttribute('uv', UV.clone());
        g.setAttribute('furUv', new THREE.BufferAttribute(fu, 2));
        g.setAttribute('aShell', new THREE.BufferAttribute(new Float32Array(n).fill(t), 1));
        byMat.get(mesh.material).push(g);
      }
      src.dispose();
    }
    for (const [material, parts] of byMat) {
      const coat = new THREE.Mesh(mergeGeometries(parts), furMaterial(material, curl, shade));
      coat.receiveShadow = true;
      scene.add(coat);
      hideFromAO.push(coat);      // the solid surface underneath does the occluding
      parts.forEach(g => g.dispose());
    }
  }

  function tex(w, h, draw, repeatX = 1, repeatY = repeatX) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 8;
    return t;
  }

  // ---------- textures ----------
  // Soft blush plaster. One tile = 2.5 m.
  const plasterTex = tex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#fbe3ea'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i++) {
      const x = rand() * w, y = rand() * h, r = 12 + rand() * 70;
      g.fillStyle = rand() < 0.5 ? 'rgba(255,250,246,0.06)' : 'rgba(214,168,170,0.045)';
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill(); }
    }
  }, 1 / 2.5);
  const stuccoTex = plasterTex;            // the window reveals use this name

  // Pale oak planks, 0.18 m wide; the texture holds eight of them (1.44 m square).
  const plankTex = tex(1024, 1024, (g, w, h) => {
    const n = 8, pw = w / n;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {                       // each plank is a few boards end to end
        const y0 = (k + (i % 2) * 0.5) * h / 3 % h;
        g.fillStyle = `hsl(${30 + rand() * 6}, ${36 + rand() * 10}%, ${80 + rand() * 6}%)`;
        g.fillRect(i * pw, y0, pw, h / 3);
        if (y0 + h / 3 > h) g.fillRect(i * pw, 0, pw, y0 + h / 3 - h);
        g.fillStyle = 'rgba(120,90,60,0.35)'; g.fillRect(i * pw, y0, pw, 2);
      }
      g.strokeStyle = 'rgba(150,115,80,0.16)';
      for (let k = 0; k < 14; k++) {
        const x = i * pw + 6 + rand() * (pw - 12);
        g.lineWidth = 1 + rand() * 2;
        g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, h / 3, x - 6, 2 * h / 3, x, h); g.stroke();
      }
      g.fillStyle = 'rgba(110,80,55,0.45)'; g.fillRect(i * pw, 0, 2, h);
    }
  }, 1 / 1.44);

  // Glazed bathroom tiles: pink and white checks, 0.15 m each (the texture holds 4 x 4).
  const tileTex = (rx, ry) => tex(256, 256, (g, s) => {
    g.fillStyle = '#f2efe9'; g.fillRect(0, 0, s, s);
    const q = s / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? '#f9c6d4' : '#fdfbf7';
      g.fillRect(i * q + 2, j * q + 2, q - 4, q - 4);
    }
  }, rx, ry);


  // Little hearts and stars on pink, for the duvet. One tile = 0.5 m.
  const duvetTex = tex(512, 512, (g, s) => {
    g.fillStyle = '#f9cfdb'; g.fillRect(0, 0, s, s);
    const heart = (x, y, k) => {
      g.save(); g.translate(x, y); g.scale(k, k); g.beginPath();
      g.moveTo(0, 8); g.bezierCurveTo(-22, -6, -12, -26, 0, -12); g.bezierCurveTo(12, -26, 22, -6, 0, 8); g.fill(); g.restore();
    };
    const star = (x, y, r) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = (i + 0.25 + (j % 2) * 0.5) * s / 4, y = (j + 0.5) * s / 4;
      g.fillStyle = '#ffffff'; heart(x, y, 1.1);
      g.fillStyle = '#fff3b8'; star(x + s / 8, y + s / 9, 9);
    }
  }, 2, 2);

  // Polka dots: (background, dot colour, repeats).
  const dotsTex = (bg, dot, rx, ry = rx) => tex(256, 256, (g, s) => {
    g.fillStyle = bg; g.fillRect(0, 0, s, s);
    g.fillStyle = dot;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.beginPath(); g.arc((i + 0.25 + (j % 2) * 0.5) * s / 4, (j + 0.5) * s / 4, s / 22, 0, Math.PI * 2); g.fill();
    }
  }, rx, ry);

  // The desk plant's pot: cream with pink waves, as drawn.
  const wavyTex = tex(256, 128, (g, w, h) => {
    g.fillStyle = '#fff3ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f2a0b5'; g.lineWidth = 7;
    for (const y of [32, 64, 96]) { g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, y + 9 * Math.sin(x / w * Math.PI * 8)); g.stroke(); }
  });

  // The doormat: "Hi", as written on both mats in the sketch.
  const hiTex = tex(512, 320, (g, w, h) => {
    g.fillStyle = '#d9bb8c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(120,85,40,0.18)' : 'rgba(255,240,210,0.15)'; g.fillRect(rand() * w, rand() * h, 2, 6); }
    g.fillStyle = '#5a3a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 190px "Arial Rounded MT Bold", Arial, sans-serif'; g.fillText('Hi', w / 2, h / 2 + 8);
  });

  // A bunny cushion face.
  const bunnyFaceTex = tex(256, 256, (g, s) => {
    g.fillStyle = '#fff8f0'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#3a2a2e';
    for (const x of [96, 160]) { g.beginPath(); g.arc(x, 130, 10, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f5a3b8'; g.beginPath(); g.ellipse(128, 150, 9, 6, 0, 0, Math.PI * 2); g.fill();
    for (const x of [74, 182]) { g.globalAlpha = 0.5; g.beginPath(); g.ellipse(x, 158, 16, 9, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.strokeStyle = '#3a2a2e'; g.lineWidth = 4;
    g.beginPath(); g.arc(120, 160, 8, 0, Math.PI); g.stroke(); g.beginPath(); g.arc(136, 160, 8, 0, Math.PI); g.stroke();
  });

  // The bedroom print: a rainbow and a cloud over a sleeping bunny and the moon.
  const printTex = tex(512, 666, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#d9e8fb'); bg.addColorStop(1, '#fbe3ec');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    ['#f6b3c4', '#fbd9a4', '#fff0a8', '#bfe6d6', '#c6dcf5', '#d9c8f0'].forEach((c, i) => {
      g.strokeStyle = c; g.lineWidth = 22; g.beginPath(); g.arc(w / 2, 420, 200 - i * 22, Math.PI, 0); g.stroke();
    });
    g.fillStyle = '#ffffff';
    for (const [x, y, r] of [[150, 410, 52], [210, 380, 64], [280, 400, 56], [340, 420, 44], [230, 430, 60]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff3b8'; g.beginPath(); g.arc(400, 110, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9e8fb'; g.beginPath(); g.arc(420, 96, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8f0';                                  // bunny curled up on the cloud
    g.beginPath(); g.ellipse(250, 330, 56, 34, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(210, 300, 12, 34, -0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(232, 294, 12, 34, -0.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a2e'; g.lineWidth = 3; g.beginPath(); g.arc(226, 328, 6, 0, Math.PI); g.stroke();
    g.fillStyle = '#8a7a9a'; g.font = 'italic 34px Georgia, serif'; g.textAlign = 'center'; g.fillText('sweet dreams', w / 2, 590);
  });

  const woodTex = (base, grain, rep = 1) => tex(1024, 1024, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = grain;
    for (let i = 0; i < 260; i++) {
      const y = rand() * h;
      g.globalAlpha = 0.06 + rand() * 0.22; g.lineWidth = 1 + rand() * 3;
      g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(w / 3, y + rand() * 14 - 7, 2 * w / 3, y + rand() * 14 - 7, w, y); g.stroke();
    }
    g.globalAlpha = 1;
  }, rep);

  const plaidTex = (base, band, line, rx, ry = rx) => tex(256, 256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.fillStyle = band; g.globalAlpha = 0.55;
    g.fillRect(0, 40, s, 68); g.fillRect(40, 0, 68, s);
    g.globalAlpha = 1; g.strokeStyle = line; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 184); g.lineTo(s, 184); g.moveTo(184, 0); g.lineTo(184, s); g.stroke();
  }, rx, ry);

  const linenTex = (base, thread, rx, ry) => tex(256, 256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.strokeStyle = thread;
    for (let i = 0; i < s; i += 4) {
      g.globalAlpha = 0.1 + rand() * 0.2; g.lineWidth = 1;
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
    }
    g.globalAlpha = 1;
  }, rx, ry);

  const wovenTex = (rx, ry) => tex(256, 256, (g, s) => {
    g.fillStyle = '#e3c88c'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#a57f3e'; g.lineWidth = 5;
    for (let y = 16; y < s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    g.lineWidth = 3;
    for (let x = 16; x < s; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
  }, rx, ry);

  // Chunky knit for throws: ribs of little V stitches.
  const knitTex = (base, light, dark, rx, ry) => tex(128, 128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.lineWidth = 5; g.lineCap = 'round';
    for (let x = 0; x < s; x += 32) for (let y = -8; y < s; y += 16) {
      g.strokeStyle = light; g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x + 16, y + 12); g.stroke();
      g.strokeStyle = dark; g.beginPath(); g.moveTo(x + 28, y); g.lineTo(x + 16, y + 12); g.stroke();
    }
  }, rx, ry);

  // My Melody, drawn flat: a pink hood with long ears, a white face, black eyes,
  // a little yellow nose and a white flower with a yellow centre by her ear.
  function drawMelody(g, cx, cy, s) {
    g.save(); g.translate(cx, cy);
    g.lineWidth = s * 0.03; g.strokeStyle = '#d9799b';
    const ell = (x, y, rx, ry, rot, fill, stroke = true) => {
      g.beginPath(); g.ellipse(x * s, y * s, rx * s, ry * s, rot, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill(); if (stroke) g.stroke();
    };
    ell(-0.3, -0.78, 0.17, 0.42, -0.22, '#f7a8c4');
    ell(0.3, -0.78, 0.17, 0.42, 0.22, '#f7a8c4');
    ell(-0.3, -0.74, 0.08, 0.28, -0.22, '#fbc9da', false);
    ell(0.3, -0.74, 0.08, 0.28, 0.22, '#fbc9da', false);
    ell(0, 0, 0.62, 0.52, 0, '#f7a8c4');
    ell(0, 0.08, 0.48, 0.37, 0, '#ffffff');
    ell(-0.19, 0.06, 0.04, 0.06, 0, '#2a1d20', false);
    ell(0.19, 0.06, 0.04, 0.06, 0, '#2a1d20', false);
    ell(0, 0.17, 0.055, 0.04, 0, '#f6cf3a', false);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 - Math.PI / 2;
      ell(0.38 + Math.cos(a) * 0.09, -0.36 + Math.sin(a) * 0.09, 0.075, 0.075, 0, '#ffffff');
    }
    ell(0.38, -0.36, 0.05, 0.05, 0, '#f6cf3a', false);
    g.restore();
  }
  const heart2d = (g, x, y, k) => {
    g.save(); g.translate(x, y); g.scale(k, k); g.beginPath();
    g.moveTo(0, 8); g.bezierCurveTo(-22, -6, -12, -26, 0, -12); g.bezierCurveTo(12, -26, 22, -6, 0, 8); g.fill(); g.restore();
  };
  const flower2d = (g, x, y, r) => {
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f6cf3a'; g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.fill();
  };

  // The living-room rug: blush pink, a white scalloped border, Melody in the middle, hearts and daisies about her.
  const rugTex = tex(1024, 738, (g, w, h) => {
    g.fillStyle = '#fde3ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let x = 40; x < w - 20; x += 46) for (const y of [30, h - 30]) { g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill(); }
    for (let y = 40; y < h - 20; y += 46) for (const x of [30, w - 30]) { g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#f4a6bf'; g.lineWidth = 10; g.strokeRect(62, 62, w - 124, h - 124);
    for (let i = 0; i < 30; i++) {
      const x = 110 + rand() * (w - 220), y = 110 + rand() * (h - 220);
      if (Math.hypot(x - w / 2, (y - h / 2 - 40) * 1.2) < 270) continue;
      if (i % 2) { g.fillStyle = '#f7a8c4'; heart2d(g, x, y, 1.1); } else flower2d(g, x, y, 11);
    }
    drawMelody(g, w / 2, h / 2 + 70, 240);
  });
  // The kids' round rug: Melody in a ring of flowers.
  const melodyRoundTex = tex(1024, 1024, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f9c1d3'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fde3ec'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; flower2d(g, s / 2 + Math.cos(a) * s * 0.435, s / 2 + Math.sin(a) * s * 0.435, 14); }
    drawMelody(g, s / 2, s / 2 + 90, 260);
  });
  // Bedding: little Melody faces and hearts on pale pink. One tile = 0.5 m.
  const melodyBedTex = tex(512, 512, (g, s) => {
    g.fillStyle = '#fde6ee'; g.fillRect(0, 0, s, s);
    for (const [x, y] of [[128, 150], [384, 406]]) drawMelody(g, x, y, 62);
    g.fillStyle = '#f7a8c4';
    for (const [x, y] of [[384, 140], [128, 400]]) heart2d(g, x, y, 1.3);
    for (const [x, y] of [[250, 270], [20, 270], [250, 20], [490, 500]]) flower2d(g, x, y, 9);
  }, 2, 2);
  // A cushion face.
  const melodyCushionTex = tex(256, 256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    drawMelody(g, s / 2, s / 2 + 40, 92);
  });
  // A print for the walls: Melody among flowers under a pastel sky.
  const melodyPosterTex = tex(512, 682, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#dff0fb'); bg.addColorStop(1, '#fde3ec');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (const [x, y, r] of [[90, 110, 40], [140, 95, 52], [190, 112, 38], [380, 70, 30], [420, 60, 40], [455, 75, 28]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#bfe6c8'; g.beginPath(); g.ellipse(w / 2, h + 60, w * 0.8, 200, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 16; i++) flower2d(g, 30 + rand() * (w - 60), h - 120 + rand() * 100, 10 + rand() * 6);
    drawMelody(g, w / 2, h / 2 + 50, 170);
    g.fillStyle = '#f7a8c4';
    for (const [x, y] of [[80, 300], [440, 260], [420, 420]]) heart2d(g, x, y, 1.4);
  });


  // The land outside. The room is high in a building on the cliff edge of a
  // hilltop town, so the country lies far below: a ring of distant ridges on the
  // horizon, then the valley floor falling away beneath the window, a patchwork
  // of fields, vineyards, white roads and farmhouses. Painted on a clear
  // background; the sky, the clouds and the light on the land come from the shader.
  const LAND = { w: 8192, h: 1280, horizon: 466 };        // the horizon sits 14 m up a 22 m tall backdrop
  const landTex = tex(LAND.w, LAND.h, (g, w, h) => {
    const H0 = LAND.horizon, wrap = draw => { for (const ox of [-w, 0, w]) draw(ox); };
    // two faint ridges right on the horizon, low enough for the sun to clear within minutes
    [['#8d8fb0', 0, 7, 3, 7], ['#7f879c', 14, 12, 4, 9]].forEach(([color, drop, amp, k1, k2]) => {
      const p1 = rand() * 6, p2 = rand() * 6;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, H0 + drop + amp * Math.sin(x / w * Math.PI * 2 * k1 + p1) + amp * 0.5 * Math.sin(x / w * Math.PI * 2 * k2 + p2));
      g.lineTo(w, h); g.fill();
    });
    // the valley floor: rows of fields that grow as they come nearer (lower on the canvas)
    const palette = ['#6f7f45', '#8a8f4e', '#a39a5a', '#7b6f44', '#5f7340', '#93834f', '#4f6a3c', '#b0a468', '#667a3e', '#9c8f58'];
    const rows = 16, top = H0 + 30, rowY = i => top + (h - top) * Math.pow(i / rows, 1.7);
    for (let i = 0; i < rows; i++) {
      const y0 = rowY(i), y1 = rowY(i + 1), scale = 0.25 + i / rows * 2.2;
      let x = 0;
      while (x < w) {
        const fw = Math.min(w - x, (120 + rand() * 260) * scale), lean = (rand() - 0.5) * 60 * scale;
        g.fillStyle = palette[rand() * palette.length | 0];
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x + fw, y0); g.lineTo(x + fw + lean, y1 + 1); g.lineTo(x + lean, y1 + 1); g.fill();
        if (rand() < 0.3) {                               // a vineyard or ploughed field: fine parallel rows
          g.save(); g.clip(); g.strokeStyle = 'rgba(40,50,25,0.35)'; g.lineWidth = Math.max(1, scale);
          for (let k = x - 80; k < x + fw + 80; k += 7 * scale + 3) { g.beginPath(); g.moveTo(k, y0); g.lineTo(k + lean, y1); g.stroke(); }
          g.restore();
        }
        g.strokeStyle = 'rgba(38,52,30,0.7)'; g.lineWidth = 1.5 * scale;       // hedge down the side
        g.beginPath(); g.moveTo(x + fw, y0); g.lineTo(x + fw + lean, y1); g.stroke();
        x += fw;
      }
      g.fillStyle = 'rgba(38,52,30,0.7)'; g.fillRect(0, y0 - scale, w, 2 * scale);   // hedge along the top
      for (let k = 0; k < 46; k++) {                      // cypresses and round oaks
        const tx = rand() * w, ty = y0 + rand() * (y1 - y0), th = (7 + rand() * 9) * scale, cypress = rand() < 0.6;
        g.fillStyle = cypress ? '#26392a' : '#3c5230';
        wrap(ox => { g.beginPath(); g.ellipse(tx + ox, ty - th * (cypress ? 0.5 : 0.3), th * (cypress ? 0.16 : 0.42), th * (cypress ? 0.55 : 0.34), 0, 0, Math.PI * 2); g.fill(); });
      }
      if (i > 2 && i < 13) for (let k = 0; k < 5; k++) {  // farmhouses
        const fx = rand() * w, fy = y0 + (y1 - y0) * 0.5, u = 5 * scale;
        wrap(ox => {
          g.fillStyle = '#b9a586'; g.fillRect(fx + ox - u * 1.6, fy - u * 1.5, u * 3.2, u * 1.6);
          g.fillStyle = '#8a4a34'; g.beginPath(); g.moveTo(fx + ox - u * 2, fy - u * 1.5); g.lineTo(fx + ox, fy - u * 2.5); g.lineTo(fx + ox + u * 2, fy - u * 1.5); g.fill();
        });
      }
    }
    // white gravel roads winding down from the horizon
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let r = 0; r < 5; r++) {
      const baseX = (r + 0.5) * w / 5 + (rand() - 0.5) * 300, ph = rand() * 6;
      for (let i = 0; i < 60; i++) {
        const t0 = i / 60, t1 = (i + 1) / 60, at = t => [baseX + 380 * Math.sin(t * 7 + ph) * t + 200 * t, top + (h - top) * Math.pow(t, 1.7)];
        const [xa, ya] = at(t0), [xb, yb] = at(t1);
        g.strokeStyle = '#d9cdb4'; g.lineWidth = 1.5 + t0 * 16;
        wrap(ox => { g.beginPath(); g.moveTo(xa + ox, ya); g.lineTo(xb + ox, yb); g.stroke(); });
      }
    }
    // distance: haze thickest at the horizon, and mist lying in the valley
    const haze = g.createLinearGradient(0, H0 - 10, 0, H0 + 420);
    haze.addColorStop(0, 'rgba(176,170,196,0.85)'); haze.addColorStop(0.25, 'rgba(176,170,196,0.5)'); haze.addColorStop(1, 'rgba(176,170,196,0)');
    g.globalCompositeOperation = 'source-atop';          // only where land has been painted
    g.fillStyle = haze; g.fillRect(0, H0 - 10, w, 430);
    for (let i = 0; i < 36; i++) {
      const mx = rand() * w, my = H0 + 60 + rand() * 300, mw = 300 + rand() * 700;
      const mist = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      mist.addColorStop(0, 'rgba(255,236,226,0.5)'); mist.addColorStop(1, 'rgba(255,236,226,0)');
      wrap(ox => { g.save(); g.translate(mx + ox, my); g.scale(mw, 22 + rand() * 30); g.fillStyle = mist; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore(); });
    }
    g.globalCompositeOperation = 'source-over';
  });

  // The neighbours to the south: plaster fronts with shuttered windows, pantile roofs.
  const facadeTex = tex(512, 512, (g, s) => {
    g.fillStyle = '#e9dcc4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {                       // weathering
      g.fillStyle = rand() < 0.5 ? 'rgba(255,245,225,0.06)' : 'rgba(120,90,60,0.06)';
      g.beginPath(); g.arc(rand() * s, rand() * s, 8 + rand() * 50, 0, Math.PI * 2); g.fill();
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const x = 64 + c * 170, y = 34 + r * 124, ww = 48, wh = 78;
      g.fillStyle = '#cbbd9f'; g.fillRect(x - 8, y - 8, ww + 16, wh + 18);         // stone surround
      g.fillStyle = '#1d2228'; g.fillRect(x, y, ww, wh);                           // dark glass
      g.fillStyle = (r + c) % 3 ? '#4f6a4a' : '#6b4a33';                           // shutters, some folded back
      if ((r * 3 + c) % 4 === 1) g.fillRect(x, y, ww, wh);
      else { g.fillRect(x - 26, y, 24, wh); g.fillRect(x + ww + 2, y, 24, wh); }
    }
  });
  const roofTex = tex(256, 256, (g, s) => {
    g.fillStyle = '#a8553a'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      g.fillStyle = `hsl(${12 + rand() * 10}, ${45 + rand() * 15}%, ${36 + rand() * 12}%)`; g.fillRect(x, 0, 11, s);
      g.fillStyle = 'rgba(40,15,8,0.45)'; g.fillRect(x + 11, 0, 5, s);
    }
    g.strokeStyle = 'rgba(40,15,8,0.3)'; g.lineWidth = 2;
    for (let y = 0; y < s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  }, 3, 2);

  // ---------- shared materials: a soft pastel palette with gold accents ----------
  const P = { pink: 0xf7b6c8, blush: 0xfbe0e8, mint: 0xbfe6d6, lilac: 0xd9c8f0, butter: 0xfbe7a6, sky: 0xc6e2f5, cream: 0xfff6ea, white: 0xfdfaf6 };
  const paint = c => mat(c, null, { roughness: 0.5 });
  const wood = (base, grain, rep) => { const t = woodTex(base, grain, rep); return mat(0xffffff, t, { bumpMap: t, bumpScale: 0.5, roughness: 0.6 }); };
  const oak = wood('#ecd9bd', '#c4a47c');
  const gold = mat(0xe2bd6b, null, { metalness: 0.85, roughness: 0.3 });
  const chrome = mat(0xeef0f3, null, { metalness: 1, roughness: 0.18 });
  const porcelain = mat(0xffffff, null, { roughness: 0.12 });
  const cream = paint(P.cream);
  const velvet = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff) });
  const leafGreen = mat(0x6fae7c, null, { roughness: 0.6 });
  // the window parts: white frames, gold fittings
  const frameWood = paint(P.white), iron = gold, brass = gold, stone = paint(P.white);
  // Bevelled panes use real transmission, so the view outside bends at the bevels.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 0.02, ior: 1.52, thickness: 0.06, specularIntensity: 1 });
  // A box with properly round, soft edges (radius r), for the plump cartoon furniture.
  const soft = (w, h, d, r, material, x, y, z, parent) =>
    add(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2.01)), material, x, y, z, parent);
  const turn = (pts, segs = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

  // ---------- lighting ----------
  // Every lamp starts off. The only real light is the sun, and it moves: setSun()
  // near the end of this file drives everything declared here.
  scene.background = new THREE.Color(0x090b12);
  const skyFill = new THREE.HemisphereLight(0x7f93cc, 0x3c2a20, 0.1);     // what little the sky gives
  scene.add(skyFill);

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.target.position.set(0, 1.3, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 2;
  // The sun comes from the east (-x), so its shadow camera spans the home's whole north-south length.
  const sunBox = { left: -7.4, right: 7.4, top: 2.8, bottom: -2.8, near: 0.5, far: 30 };
  Object.assign(sun.shadow.camera, sunBox);
  scene.add(sun, sun.target);

  // what the sunlit patches throw back: the living-room floor, the bed, the kids' floor
  const bounces = [[1.3, 0.9, 2.0, 1.2], [1.6, 1.0, 7.7, 0.9], [5.9, 0.9, 12.6, 0.8]].map(([x, y, z, power]) => {
    const light = new THREE.PointLight(0xff9558, 0, 5, 2);
    light.position.set(x, y, z);
    root.add(light);
    return [light, power];
  });

  // A dim procedural dawn for image-based fill and for reflections in glass, glaze and brass.
  {
    const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { sd: { value: new THREE.Vector3(-1, 0.10, -0.12).normalize() } },
      vertexShader: 'varying vec3 d; void main(){ d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `varying vec3 d; uniform vec3 sd;
        void main(){ vec3 n = normalize(d);
          vec3 c = mix(vec3(.30,.20,.20), vec3(.06,.09,.22), smoothstep(-.05,.55,n.y));
          c = mix(vec3(.07,.05,.04), c, smoothstep(-.35,.0,n.y));
          float s = max(dot(n, sd), 0.);
          c += vec3(4.,1.7,.5) * pow(s, 10.) + vec3(.8,.35,.15) * pow(s, 2.5);
          gl_FragColor = vec4(c, 1.); }`,
    })));
    scene.environment = pmrem.fromScene(env, 0.03).texture;
    scene.environmentIntensity = 0.3;
    pmrem.dispose();
  }

  // ---------- the shell ----------
  // The outline of the home, going round from the south-east corner.
  const footprint = [[0, 0], [XE, 0], [XE, ZK], [XB, ZK], [XB, ZH2], [XH2, ZH2], [XH2, ZN], [0, ZN], [0, ZM], [XH, ZM], [XH, ZL], [0, ZL]];
  const outline = flip => new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, flip ? -z : z)));
  const floor = add(new THREE.ShapeGeometry(outline(true)), mat(0xffffff, plankTex, { roughness: 0.55, bumpMap: plankTex, bumpScale: 0.4 }), 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  const base = add(new THREE.ExtrudeGeometry(outline(true), { depth: 0.3, bevelEnabled: false }), mat(0x2a2326), 0, -0.302, 0);
  base.rotation.x = -Math.PI / 2;
  base.castShadow = false;
  const bathFloor = add(new THREE.PlaneGeometry(XE - XB, ZN - ZM), mat(0xffffff, tileTex((XE - XB) / 0.6, (ZN - ZM) / 0.6), { roughness: 0.25 }), (XB + XE) / 2, 0.003, (ZM + ZN) / 2);
  bathFloor.rotation.x = -Math.PI / 2;
  bathFloor.castShadow = false;
  const ceiling = add(new THREE.ShapeGeometry(outline(false)), mat(0xfffaf4, null, { roughness: 1, shadowSide: THREE.DoubleSide }), 0, H, 0);
  ceiling.rotation.x = Math.PI / 2;

  // Outer walls are single inward-facing sheets: they vanish when seen from
  // behind, yet still block the sun, so light only enters through the windows.
  // openings: [left, right, bottom, top] in the wall's own x; a bottom of 0 is a doorway.
  const wallMat = mat(0xffffff, plasterTex, { roughness: 1, shadowSide: THREE.DoubleSide, bumpMap: plasterTex, bumpScale: 0.5 });
  function wall(width, openings, x, z, rotY) {
    const s = new THREE.Shape(), doors = openings.filter(o => o[2] === 0).sort((a, b) => a[0] - b[0]);
    s.moveTo(-width / 2, 0);
    for (const [a, b, , top] of doors) { s.lineTo(a, 0); s.lineTo(a, top); s.lineTo(b, top); s.lineTo(b, 0); }
    s.lineTo(width / 2, 0); s.lineTo(width / 2, H); s.lineTo(-width / 2, H); s.closePath();
    for (const [a, b, y0, y1] of openings.filter(o => o[2] > 0)) {
      const hole = new THREE.Path();
      hole.moveTo(a, y0); hole.lineTo(a, y1); hole.lineTo(b, y1); hole.lineTo(b, y0); hole.closePath();
      s.holes.push(hole);
    }
    const m = add(new THREE.ShapeGeometry(s), wallMat, x, 0, z);
    m.rotation.y = rotY;
  }
  // An outer wall from a to b along x (at z = at) or along z (at x = at); `inward` is the
  // side the room is on (+1 or -1). Openings are given in plan coordinates along the wall.
  function outer(axis, at, a, b, inward, openings = []) {
    const mid = (a + b) / 2;
    const rotY = axis === 'x' ? (inward > 0 ? 0 : Math.PI) : (inward > 0 ? Math.PI / 2 : -Math.PI / 2);
    const local = v => axis === 'x' ? (inward > 0 ? v - mid : mid - v) : (inward > 0 ? mid - v : v - mid);
    const ops = openings.map(([p, q, y0, y1]) => [Math.min(local(p), local(q)), Math.max(local(p), local(q)), y0, y1]);
    wall(Math.abs(b - a), ops, axis === 'x' ? mid : at, axis === 'x' ? at : mid, rotY);
  }
  outer('x', 0, 0, XE, 1);                                         // south: the kitchen and the sofa
  outer('z', XE, 0, ZK, -1);                                       // west
  outer('x', ZK, XB, XE, -1);                                      // the kids' room, north
  outer('z', XB, ZH2, ZK, 1, [KIDS_WIN]);                          // the kids' room, east, over the courtyard
  outer('x', ZH2, XH2, XB, -1);                                    // the little hall, north
  outer('z', XH2, ZN, ZH2, 1);                                     // the little hall, east
  outer('x', ZN, 0, XH2, -1);                                      // the main bedroom, north
  outer('z', 0, ZM, ZN, 1, [BED_WIN]);                             // the main bedroom, east: the window over the bed
  outer('x', ZM, 0, XH, 1);                                        // the main bedroom, south
  outer('z', XH, ZL, ZM, 1);                                       // the hallway, east
  outer('x', ZL, 0, XH, -1);                                       // the living room, north (behind the TV)
  outer('z', 0, 0, ZL, 1, [LIVING_WIN]);                           // the living room, east

  // Inner walls: real blocks. Where one is cut off (its top, and any end that meets
  // an outer wall) it shows the dark section colour, as in an architect's cut-away model.
  const inner = mat(0xffffff, plasterTex, { roughness: 1 }), cut = mat(0x3b3036, null, { roughness: 1 });
  const block = (x0, x1, z0, z1, ends = '', y0 = 0, y1 = H) => {
    const faces = ['+x', '-x', '+y', '-y', '+z', '-z'].map(k => (k === '+y' ? y1 >= H : ends.includes(k)) ? cut : inner);
    return add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), faces, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  function partition(axis, at, from, to, doors = [], ends = '', t = T) {
    const lo = axis === 'x' ? '-x' : '-z', hi = axis === 'x' ? '+x' : '+z';
    const piece = (p, q, y0, e) => axis === 'x' ? block(p, q, at - t / 2, at + t / 2, e, y0) : block(at - t / 2, at + t / 2, p, q, e, y0);
    let a = from;
    for (const [p, q] of doors) {
      piece(a, p, 0, a === from && ends.includes(lo) ? lo : '');
      piece(p, q, DOOR_H, '');
      a = q;
    }
    piece(a, to, 0, (ends.includes(hi) ? hi : '') + (a === from && ends.includes(lo) ? lo : ''));
  }
  partition('z', XB, ZL, ZN, [EN_SUITE]);               // hallway | dining, then bedroom | bathroom
  partition('x', ZM, XH, XE, [HALL_DOOR], '-x+x');      // hallway | bedroom, then dining | bathroom
  partition('x', ZN, XH2, XE, [DOOR5], '-x+x');         // bedroom | little hall, then bathroom | kids' room
  partition('z', XB, ZN, ZH2, [KIDS_DOOR], '+z');       // little hall | kids' room
  // inside the bathroom, thinner: the toilet room's side, and the two walk-in closets
  partition('z', 6.5, 8.3, ZN, [], '', 0.08);
  partition('x', 8.0, 7.6, XE, [], '+x', 0.08);
  partition('z', 7.6, ZM, 6.4, [], '', 0.08);
  partition('z', 7.6, 9.2, ZN, [], '', 0.08);

  // white architraves round every doorway, on both faces
  const trim = paint(P.white);
  function doorTrim(axis, at, [p, q]) {
    for (const s of [-1, 1]) {
      const off = at + s * (T / 2 + 0.01);
      if (axis === 'x') {
        for (const e of [p - 0.035, q + 0.035]) box(0.07, DOOR_H + 0.06, 0.02, trim, e, (DOOR_H + 0.06) / 2, off);
        box(q - p + 0.14, 0.07, 0.02, trim, (p + q) / 2, DOOR_H + 0.035, off);
      } else {
        for (const e of [p - 0.035, q + 0.035]) box(0.02, DOOR_H + 0.06, 0.07, trim, off, (DOOR_H + 0.06) / 2, e);
        box(0.02, 0.07, q - p + 0.14, trim, off, DOOR_H + 0.035, (p + q) / 2);
      }
    }
  }
  doorTrim('x', ZM, HALL_DOOR);
  doorTrim('z', XB, EN_SUITE);
  doorTrim('x', ZN, DOOR5);
  doorTrim('z', XB, KIDS_DOOR);


  // ---------- the view outside ----------
  // Drawn only where a window opening is on screen (stencil), so it never shows
  // around or above the walls.
  const portalMat = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  const throughWindows = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc };
  const outside = new THREE.Group(), townMats = [];
  scene.add(outside);
  hideFromAO.push(outside);
  const sky = {                                                     // set by setSun()
    map: { value: landTex }, uSun: { value: sunDir },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uLand: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uDisc: { value: 0 }, uTime: { value: 0 },
  };
  const eye = 1.4, R = 20, tall = 22, y0 = eye - tall * (1 - LAND.horizon / LAND.h);   // horizon at eye level, most of the backdrop below it
  const pano = new THREE.Mesh(new THREE.CylinderGeometry(R, R, tall, 96, 1, true), new THREE.ShaderMaterial({
    uniforms: sky, side: THREE.BackSide, ...throughWindows,
    vertexShader: `varying vec3 vDir; varying vec2 vUv;
      void main(){ vUv = uv; vDir = (modelMatrix * vec4(position, 1.)).xyz - vec3(0., ${eye.toFixed(1)}, 0.);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uSun, uZenith, uHorizon, uGlow, uLand, uCloud; uniform float uDisc, uTime;
      varying vec3 vDir; varying vec2 vUv;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
      float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17., 9.); a *= .5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float toSun = max(dot(d, uSun), 0.);
        float sameSide = max(dot(normalize(d.xz), normalize(uSun.xz)), 0.);
        vec3 c = mix(uHorizon, uZenith, pow(clamp(d.y * 2.2 + .02, 0., 1.), .55));
        c += uGlow * (.55 * pow(toSun, 6.) + .9 * pow(toSun, 40.) + .5 * exp(-abs(d.y) * 9.) * pow(sameSide, 3.));
        c += uDisc * vec3(1., .42, .1) * smoothstep(.99988, .99993, dot(d, uSun));          // the sun's disc
        if (d.y > 0.) {                                                                      // clouds, on a flat layer overhead
          vec2 cp = d.xz / (d.y + .12) * 1.4 + vec2(uTime * .012, uTime * .004);             // drifting on the wind
          float dens = fbm(cp), cover = smoothstep(.5, .74, dens);
          float thin = clamp((dens - fbm(cp + normalize(uSun.xz) * .35)) * 3. + .5, 0., 1.); // less cloud towards the sun = lit side
          vec3 cl = mix(uCloud * .3, uCloud * 1.5 + uGlow * .7 * pow(toSun, 2.), thin);
          cl += uGlow * 1.4 * pow(toSun, 12.) * (1. - cover * .5);                           // edges catch fire near the sun
          c = mix(c, cl, cover * smoothstep(0., .1, d.y) * .92);
        }
        vec4 t = texture2D(map, vUv);                                                        // the land, in front of all that
        gl_FragColor = vec4(mix(c, t.rgb * uLand * (1. + 1.5 * pow(sameSide, 4.)), t.a), 1.);
      }`,
  }));
  pano.position.y = y0 + tall / 2;
  pano.renderOrder = -1;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ ...throughWindows }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = y0;
  ground.renderOrder = -1;
  outside.add(pano, ground);

  // The town: neighbours to the south-east and north-east, stepping down to the
  // cliff edge, a bell tower, and the valley opening to the east below every window.
  // Real geometry (world coordinates here: east is -x, south is -z), so it shifts as you move.
  {
    const seenThrough = m => Object.assign(m, throughWindows);
    // Out of doors the whole sky lights a wall, far more than it lights our rooms.
    // That open-air skylight is given to these materials as a glow that setSun() raises with the dawn.
    const openAir = (map, tint) => {
      const m = seenThrough(new THREE.MeshStandardMaterial({ map, color: tint, roughness: 1, emissiveMap: map, emissive: 0x000000 }));
      townMats.push([m, new THREE.Color(tint)]);
      return m;
    };
    const tiles = openAir(roofTex, 0xffffff);
    const hip = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4);      // a hipped roof one unit square
    const street = -9;                                                                 // how far below our floor the lane is
    function house(x, z, w, d, eave, tint, pitch = 1.3) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, eave - street, d), openAir(facadeTex, tint));
      body.position.set(x, (eave + street) / 2, z);
      const roof = new THREE.Mesh(hip, tiles);
      roof.scale.set(w + 0.5, pitch, d + 0.5);
      roof.position.set(x, eave + pitch / 2, z);
      outside.add(body, roof);
    }
    house(-10.5, -11.5, 6, 5, 2.4, 0xf3dccb);
    house(-15.5, -7.5, 5, 6, -1.5, 0xe9c9a0, 1.5);           // lower, towards the cliff: we look down on its roof
    house(-6.5, -15.5, 7, 5, 4.0, 0xf2e2c4);
    house(-12.5, -13.8, 2.6, 2.6, 8.2, 0xdcc9a8, 2.2);       // the bell tower
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 2.7), seenThrough(new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 1 })));
    belfry.position.set(-12.5, 7.0, -13.8);
    house(-10.5, 12.5, 6, 5, 1.6, 0xead2b0);
    house(-15.5, 8.5, 5, 5, -2.2, 0xe3b98e, 1.2);
    const cypress = new THREE.Mesh(new THREE.ConeGeometry(0.7, 6.5, 10), seenThrough(new THREE.MeshStandardMaterial({ color: 0x24382a, roughness: 1 })));
    cypress.position.set(-8.2, -1.6, 7.5);
    outside.add(belfry, cypress);

    // Our own building, seen across the courtyard from the kids' window: the outside
    // faces of the main bedroom and the little hall, running down to the lane.
    const outFace = (w, x, z, rotY) => {
      const h = H + 0.4 - street, t = facadeTex.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 4, h / 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), openAir(t, 0xf4e1d6));
      m.position.set(x, (H + 0.4 + street) / 2, z);
      m.rotation.y = rotY;
      root.add(m);
      hideFromAO.push(m);
    };
    outFace(XH2, XH2 / 2, ZN + 0.002, 0);                          // the bedroom's north face
    outFace(ZH2 - ZN, XH2 - 0.002, (ZN + ZH2) / 2, -Math.PI / 2);  // the hall's east face
    outFace(XB - XH2, (XH2 + XB) / 2, ZH2 + 0.002, 0);             // the hall's north face
  }


  // ---------- windows ----------
  function paneGeo(pw, ph) {
    const b = 0.022, a = pw / 2 - b, c = ph / 2 - b, s = new THREE.Shape();
    s.moveTo(-a, -c); s.lineTo(a, -c); s.lineTo(a, c); s.lineTo(-a, c); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelSize: b, bevelThickness: 0.007, bevelSegments: 1 });
    geo.translate(0, 0, -0.002);
    return geo;
  }

  // A two-leaf wooden casement, three bevelled panes per leaf, with a handle on each leaf.
  // open = how far each leaf is swung into the room, in radians: [left, right]
  function casement(w, h, parent, open = [0, 0]) {
    const f = 0.05, st = 0.045, mu = 0.024;
    for (const s of [-1, 1]) {
      box(w, f, 0.07, frameWood, 0, s * (h - f) / 2, 0, parent);
      box(f, h - 2 * f, 0.07, frameWood, s * (w - f) / 2, 0, 0, parent);
    }
    const iw = w - 2 * f, ih = h - 2 * f, lw = iw / 2;
    const pw = lw - 2 * st, ph = (ih - 2 * st - 2 * mu) / 3;
    const geo = paneGeo(pw, ph);
    for (const s of [-1, 1]) {
      const hinge = group(s * iw / 2, 0, 0.012, s * open[s < 0 ? 0 : 1], parent);
      const leaf = group(-s * lw / 2, 0, 0, 0, hinge);
      for (const t of [-1, 1]) {
        box(st, ih, 0.045, frameWood, t * (lw - st) / 2, 0, 0, leaf);
        box(pw, st, 0.045, frameWood, 0, t * (ih - st) / 2, 0, leaf);
      }
      for (let i = -1; i <= 1; i++) {
        const pane = new THREE.Mesh(geo, glass);
        pane.position.y = i * (ph + mu);
        leaf.add(pane);
        hideFromAO.push(pane);
        if (i < 1) box(pw, mu, 0.035, frameWood, 0, (i + 0.5) * (ph + mu), 0, leaf);
      }
      // handle: iron plate fixed to the stile, a short stem, then the brass knob
      const hx = -s * (lw - st) / 2, face = 0.0225;
      box(0.026, 0.15, 0.008, iron, hx, -0.05, face + 0.004, leaf);
      cyl(0.006, 0.006, 0.035, iron, hx, -0.05, face + 0.0255, leaf).rotation.x = Math.PI / 2;
      ball(0.019, brass, hx, -0.05, face + 0.053, leaf, 1, 1, 0.8);
    }
  }

  // tie: the edge (-1 or +1) a tie-back gathers the curtain towards, or 0 to let it hang straight
  function curtain(width, height, material, tie = 0) {
    const geo = new THREE.PlaneGeometry(width, height, 80, tie ? 30 : 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = 0.028 * Math.sin(x / width * Math.PI * 9);
      if (tie) {
        const up = p.getY(i) / height + 0.5, pinch = Math.exp(-(((up - 0.42) / 0.2) ** 2)) * 0.72;
        x = x * (1 - pinch) + tie * width / 2 * pinch;
        z *= 1 + pinch * 0.8;
      }
      p.setX(i, x);
      p.setZ(i, z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // The breeze. Curtains by the open window are pinned at the rod and free at
  // the hem; the wind comes in swells, pushing them into the room and letting
  // them fall back. The same motion is applied wherever those curtains are
  // drawn (colour, shadow, and the depth map the light beams use).
  const wind = { uTime: { value: 0 }, uWind: { value: 0 } };
  const blown = material => {
    material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, wind);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float hang = 1. - uv.y, free = hang * hang;
          float swell = .55 + .45 * sin(uTime * .6) * sin(uTime * .23 + 1.3);
          float ripple = .5 + .5 * sin(uTime * 1.7 - hang * 3.2 + position.x * 5.);
          transformed.z += uWind * free * swell * (.09 + .06 * ripple);
          transformed.x += uWind * free * .035 * sin(uTime * 1.1 + hang * 4.);
          transformed.y += uWind * free * swell * .02;`);
    };
    material.customProgramCacheKey = () => 'blown';
    return material;
  };
  const windCurtains = [];
  const blownDepth = blown(new THREE.MeshDepthMaterial({ side: THREE.DoubleSide }));
  const blownMask = blown(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  // A window set `depth` metres into the wall, with an iron rod and a pair of curtains.
  function windowUnit(w, depth, x, z, rotY, curtainMat, curtainBottom, open, tied, y0 = Y0, y1 = Y1) {
    const h = y1 - y0, g = group(x, (y0 + y1) / 2, z, rotY);
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(w, h), portalMat);
    portal.renderOrder = -2;
    g.add(portal);
    hideFromAO.push(portal);
    // the reveal: plaster cheeks and head, a stone sill
    const plaster = mat(0xffffff, stuccoTex, { roughness: 1, shadowSide: THREE.DoubleSide });
    const sillStone = mat(0xe6dcc4, null, { roughness: 0.9, shadowSide: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const cheek = add(new THREE.PlaneGeometry(depth, h), plaster, s * w / 2, 0, -depth / 2, g);
      cheek.rotation.y = -s * Math.PI / 2;
      const lid = add(new THREE.PlaneGeometry(w, depth), s < 0 ? sillStone : plaster, 0, s * h / 2, -depth / 2, g);
      lid.rotation.x = s * Math.PI / 2;
    }
    box(w + 0.1, 0.035, 0.06, stone, 0, -h / 2 - 0.0175, 0.03, g);          // sill nosing
    casement(w, h, group(0, 0, -depth + 0.035, 0, g), open);

    const rodY = h / 2 + 0.12, rodLen = w + 0.56, yb = curtainBottom - (y0 + y1) / 2;
    cyl(0.011, 0.011, rodLen, iron, 0, rodY, 0.09, g).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      ball(0.024, iron, s * rodLen / 2, rodY, 0.09, g);
      box(0.012, 0.012, 0.09, iron, s * (w / 2 + 0.2), rodY, 0.045, g);
      const c = curtain(0.32, rodY - yb, curtainMat, tied ? s : 0);
      c.position.set(s * (w / 2 + 0.09), (rodY + yb) / 2, 0.09);
      g.add(c);
      if (tied) {                                  // the tie-back band
        const band = add(new THREE.TorusGeometry(0.035, 0.01, 8, 24), brass, s * (w / 2 + 0.09 + 0.16 * 0.72), yb + 0.42 * (rodY - yb), 0.09, g);
        band.rotation.x = Math.PI / 2;
        band.scale.set(1, 1.6, 1);
      }
      if (open) { c.customDepthMaterial = blownDepth; windCurtains.push(c); }
    }
    return g;
  }

  // ---------- window placements: all three face east ----------
  const sheerPink = mat(0xffffff, linenTex('#fbe1e8', '#e9b3c3', 3, 10), { side: THREE.DoubleSide });
  const dottyPink = mat(0xffffff, dotsTex('#fbd3df', '#ffffff', 3, 8), { side: THREE.DoubleSide });
  const DEEP = 0.3;                                                     // old stone walls: windows sit back in them
  const breezySheer = blown(new THREE.MeshStandardMaterial({ map: sheerPink.map, roughness: 0.85, side: THREE.DoubleSide }));
  const [lz0, lz1, ly0, ly1] = LIVING_WIN, [bz0, bz1, by0, by1] = BED_WIN, [kz0, kz1, ky0, ky1] = KIDS_WIN;
  windowUnit(lz1 - lz0, DEEP, 0, (lz0 + lz1) / 2, Math.PI / 2, breezySheer, 0.8, [1.4, 1.3], false, ly0, ly1);   // living room: open, with the breeze
  windowUnit(bz1 - bz0, DEEP, 0, (bz0 + bz1) / 2, Math.PI / 2, sheerPink, 1.25, undefined, true, by0, by1);      // over the bed
  windowUnit(kz1 - kz0, DEEP, XB, (kz0 + kz1) / 2, Math.PI / 2, dottyPink, 0.3, undefined, true, ky0, ky1);      // the kids' room


  // ---------- small shared pieces ----------
  const heartShape = k => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5 * k);
    s.bezierCurveTo(-0.15 * k, -0.35 * k, -0.55 * k, -0.1 * k, -0.5 * k, 0.18 * k);
    s.bezierCurveTo(-0.45 * k, 0.48 * k, -0.08 * k, 0.5 * k, 0, 0.25 * k);
    s.bezierCurveTo(0.08 * k, 0.5 * k, 0.45 * k, 0.48 * k, 0.5 * k, 0.18 * k);
    s.bezierCurveTo(0.55 * k, -0.1 * k, 0.15 * k, -0.35 * k, 0, -0.5 * k);
    return s;
  };
  const starShape = (r, inner = 0.5) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * inner : r;
      i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return s;
  };
  // a plump shape cut from a flat outline, standing up and facing +z
  const puffed = (shape, depth, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
    g.center();
    return g;
  };
  // a chest of drawers built facing +z, then turned into place
  function drawers(w, h, d, rows, cols, x, z, rotY, body, front) {
    const g = group(x, 0, z, rotY), foot = 0.07;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.022, 0.014, foot, gold, sx * (w / 2 - 0.06), foot / 2, sz * (d / 2 - 0.06), g);
    soft(w, h - foot, d, 0.03, body, 0, foot + (h - foot) / 2, 0, g);
    const cw = w / cols, rh = (h - foot - 0.05) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dx = (c + 0.5) * cw - w / 2, dy = foot + 0.025 + (r + 0.5) * rh;
      soft(cw - 0.04, rh - 0.035, 0.02, 0.008, front, dx, dy, d / 2 + 0.006, g);
      ball(0.016, gold, dx, dy, d / 2 + 0.025, g);
    }
    return g;
  }
  const book = (w, h, d, color, x, y, z, rotY, parent) => {
    const b = group(x, y, z, rotY, parent);
    box(w, h, d, paint(color), 0, h / 2, 0, b);
    box(w - 0.012, h - 0.012, d - 0.006, cream, 0.004, h / 2, 0, b);
    return b;
  };
  function picture(map, w, h, border, frameMat, parent) {
    flat(w + border * 2, h + border * 2, frameMat, 0, 0, 0, parent);
    flat(w, h, new THREE.MeshStandardMaterial({ map, roughness: 0.6 }), 0, 0, 0.003, parent);
  }
  // a pastel lampshade (lamps are off: it is sunrise)
  const shadeMat = (color, map) => new THREE.MeshStandardMaterial({ color, map, emissiveMap: map, emissive: 0x000000, roughness: 0.9, side: THREE.DoubleSide });
  const bulbMat = () => new THREE.MeshStandardMaterial({ color: 0xfff8e8, emissive: 0x000000, roughness: 0.3 });

  // ---------- lamps you can click ----------
  // Every lamp starts off. Each one's light exists from the start at zero brightness,
  // so switching it on never makes the shaders rebuild; a click only sets numbers.
  // An invisible cylinder around each lamp is what the click actually hits.
  const lamps = [];
  function lamp(x, y, z, { hit: [r, h], shades, bulb, power, distance = 5 }) {
    const light = new THREE.PointLight(0xffb978, 0, distance, 2);
    light.position.set(x, y, z);
    root.add(light);
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(x, h / 2, z);
    root.add(proxy);
    lamps.push({ light, proxy, shades, bulb, power, on: false });
  }
  function setLamp(l, on) {
    l.on = on;
    l.light.intensity = on ? l.power : 0;
    for (const m of l.shades) { m.emissive.setRGB(1, 0.72, 0.45); m.emissiveIntensity = on ? 0.9 : 0; }
    l.bulb.emissive.setRGB(1, 0.8, 0.55);
    l.bulb.emissiveIntensity = on ? 8 : 0;
  }
  function potPlant(x, y, z, potR, potH, potMat, leaves, leafLen, spread) {
    const g = group(x, y, z);
    add(turn([[0, 0], [potR * 0.78, 0], [potR, potH * 0.92], [potR * 1.04, potH], [potR * 0.92, potH]], 32), potMat, 0, 0, 0, g);
    cyl(potR * 0.9, potR * 0.9, 0.01, mat(0x5a4636), 0, potH - 0.012, 0, g);
    const up = new THREE.Vector3(0, 1, 0), list = [];
    for (let i = 0; i < leaves; i++) {
      const a = i * 2.39996, tilt = 0.25 + (i % 3) * spread, len = leafLen * (0.75 + rand() * 0.4);
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
      const at = new THREE.Vector3(0, potH, 0).addScaledVector(dir, len * 0.55);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir).multiply(new THREE.Quaternion().setFromAxisAngle(up, a));
      list.push(new THREE.Matrix4().compose(at, q, new THREE.Vector3(len * 0.32, len / 2, len * 0.05)));
    }
    scatter(new THREE.SphereGeometry(1, 14, 10), leafGreen, list, g);
    return g;
  }
  // a cuddly toy rabbit; everything but the face is plush
  function bunnyToy(x, y, z, rotY, fur, k = 1) {
    const g = group(x, y, z, rotY), plush = [];
    const part = (r, m, px, py, pz, sx = 1, sy = 1, sz = 1, rz = 0) => {
      const p = add(new THREE.SphereGeometry(r, 20, 14), m, px * k, py * k, pz * k, g);
      p.scale.set(sx * k, sy * k, sz * k);
      p.rotation.z = rz;
      if (m === fur) plush.push(p);
      return p;
    };
    part(1, fur, 0, 0.1, 0, 0.1, 0.11, 0.09);                         // body
    part(1, fur, 0, 0.24, 0.015, 0.085, 0.08, 0.08);                  // head
    for (const s of [-1, 1]) {
      part(1, fur, s * 0.04, 0.36, 0, 0.024, 0.075, 0.016, -s * 0.18);   // ears
      part(1, paint(0xf7b7c6), s * 0.042, 0.36, 0.012, 0.012, 0.055, 0.006, -s * 0.18);
      part(1, fur, s * 0.05, 0.03, 0.06, 0.035, 0.028, 0.045);         // feet
      part(0.011, paint(0x2a1e22), s * 0.03, 0.255, 0.088);            // eyes
    }
    part(0.012, paint(0xf59ab2), 0, 0.235, 0.094);                    // nose
    part(0.03, fur, 0, 0.09, -0.09);                                  // tail
    fluff(plush, { length: 0.008 * k, layers: 10, strand: 0.002 * k, droop: 0.1, shade: 0.7 });
    return g;
  }

  // ---------- My Melody, as a plush about 35 cm tall (k = 1) ----------
  // Pink hood with long ears, a white face, black eyes, a yellow nose, a white flower
  // with a yellow centre at the foot of one ear, pink body, white paws and feet.
  function melodyToy(x, y, z, rotY, k = 1, parent = root) {
    const g = group(x, y, z, rotY, parent), plush = [];
    const pink = mat(0xf7a8c4, null, { roughness: 1 }), white = mat(0xfffafa, null, { roughness: 1 });
    const black = mat(0x231a1d, null, { roughness: 0.3 }), yellow = mat(0xf6cf3a, null, { roughness: 0.6 });
    const part = (r, m, px, py, pz, sx = 1, sy = 1, sz = 1, fur = true) => {
      const p = add(new THREE.SphereGeometry(r, 24, 16), m, px * k, py * k, pz * k, g);
      p.scale.set(sx * k, sy * k, sz * k);
      if (fur) plush.push(p);
      return p;
    };
    for (const s of [-1, 1]) part(1, white, s * 0.042, 0.022, 0.025, 0.036, 0.024, 0.05);       // feet
    part(1, pink, 0, 0.1, 0, 0.075, 0.085, 0.065);                                              // body
    for (const s of [-1, 1]) {
      const arm = part(1, pink, s * 0.075, 0.115, 0.012, 0.026, 0.05, 0.026);
      arm.rotation.z = s * 0.55;
      part(1, white, s * 0.098, 0.08, 0.02, 0.021, 0.021, 0.021);                               // paws
    }
    const hy = 0.245;
    part(1, pink, 0, hy, 0, 0.118, 0.1, 0.1);                                                   // the hood
    for (const s of [-1, 1]) {
      const ear = part(1, pink, s * 0.05, hy + 0.15, -0.012, 0.034, 0.1, 0.024);
      ear.rotation.z = -s * 0.16;
    }
    const FX = 0.094, FY = 0.074, FZ = 0.07, fy = hy - 0.02, fz = 0.048;
    part(1, white, 0, fy, fz, FX, FY, FZ);                                                      // face, framed by the hood
    const onFace = (px, py, lift) => {
      const pz = FZ * Math.sqrt(Math.max(0, 1 - (px / FX) ** 2 - (py / FY) ** 2));
      const n = new THREE.Vector3(px / FX ** 2, py / FY ** 2, pz / FZ ** 2).normalize();
      return [new THREE.Vector3(px, fy + py, fz + pz).addScaledVector(n, lift), n];
    };
    const z1 = new THREE.Vector3(0, 0, 1);
    for (const s of [-1, 1]) {
      const [at, n] = onFace(s * 0.034, 0.006, 0.008);
      part(1, black, at.x, at.y, at.z, 0.009, 0.013, 0.005, false).quaternion.setFromUnitVectors(z1, n);
    }
    const [na, nn] = onFace(0, -0.018, 0.008);
    part(1, yellow, na.x, na.y, na.z, 0.011, 0.008, 0.006, false).quaternion.setFromUnitVectors(z1, nn);
    // the flower, on the hood at the foot of her ear
    const fl = group(0.075 * k, (hy + 0.075) * k, 0.055 * k, 0, g);
    fl.rotation.set(-0.45, 0.55, 0);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      add(new THREE.SphereGeometry(0.014 * k, 12, 8), white, Math.cos(a) * 0.017 * k, Math.sin(a) * 0.017 * k, 0, fl).scale.z = 0.45;
    }
    add(new THREE.SphereGeometry(0.009 * k, 12, 8), yellow, 0, 0, 0.005 * k, fl);
    fluff(plush, { length: 0.006 * k, layers: 9, strand: 0.0017 * k, droop: 0.05, shade: 0.78 });
    return g;
  }

  // a cushion with a face on it, standing up and leaning back, facing local +z of `parent`
  function faceCushion(map, wd, x, y, z, parent, lean = 0.2) {
    const c = add(pillowGeo(wd, wd, 0.12), mat(0xffffff, map), x, y, z, parent);
    c.rotation.order = 'YXZ';
    c.rotation.set(-Math.PI / 2 + lean, Math.PI, 0);
    fluff([c], { length: 0.005, layers: 6, strand: 0.0018, shade: 0.85, uvSize: [wd, wd] });
    return c;
  }

  // A sofa built facing +z, its length along x. Returns the height of the seat and where cushions can sit.
  function sofa(len, depth, x, z, rotY, fabric) {
    const g = group(x, 0, z, rotY), arm = 0.18, backT = 0.2, seatY = 0.3, seatT = 0.14;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.025, 0.017, 0.08, gold, sx * (len / 2 - 0.08), 0.04, sz * (depth / 2 - 0.08), g);
    soft(len, 0.22, depth, 0.06, fabric, 0, 0.19, 0, g);
    soft(len, 0.44, backT, 0.08, fabric, 0, seatY + 0.22, -depth / 2 + backT / 2, g);
    for (const s of [-1, 1]) soft(arm, 0.32, depth, 0.09, fabric, s * (len / 2 - arm / 2), seatY + 0.16, 0, g);
    const inner = len - 2 * arm, n = Math.max(1, Math.round(inner / 0.62)), cw = inner / n, sd = depth - backT;
    for (let i = 0; i < n; i++) {
      const cx = -inner / 2 + (i + 0.5) * cw;
      add(pillowGeo(cw - 0.02, sd - 0.02, seatT), fabric, cx, seatY + seatT * 0.45, -depth / 2 + backT + sd / 2, g);
      const c = add(pillowGeo(cw - 0.04, 0.4, 0.17), fabric, cx, seatY + seatT + 0.19, -depth / 2 + backT + 0.09, g);
      c.rotation.x = -Math.PI / 2 + 0.18;
    }
    return { g, sit: seatY + seatT, front: -depth / 2 + backT + 0.24 };
  }

  // a chair built facing +z; the back has bunny ears, Melody style
  function chair(x, z, rotY, color, k = 1) {
    const g = group(x, 0, z, rotY), m = paint(color);
    g.scale.setScalar(k);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(0.018, 0.013, 0.44, paint(P.white), sx * 0.16, 0.22, sz * 0.16, g);
      leg.rotation.set(-sz * 0.06, 0, sx * 0.06);
    }
    soft(0.42, 0.05, 0.42, 0.02, m, 0, 0.465, 0, g);
    soft(0.36, 0.035, 0.36, 0.015, paint(P.white), 0, 0.505, 0.01, g);                         // seat pad
    for (const sx of [-1, 1]) cyl(0.014, 0.014, 0.34, m, sx * 0.17, 0.66, -0.19, g).rotation.x = -0.12;
    const back = group(0, 0.8, -0.215, 0, g);
    back.rotation.x = -0.12;
    soft(0.42, 0.22, 0.04, 0.02, m, 0, 0, 0, back);
    for (const s of [-1, 1]) {
      const ear = ball(1, m, s * 0.1, 0.22, 0, back, 0.05, 0.13, 0.018);
      ear.rotation.z = -s * 0.15;
      ball(1, paint(P.white), s * 0.1, 0.22, 0.012, back, 0.025, 0.085, 0.01).rotation.z = -s * 0.15;
    }
    return g;
  }

  // a two-door wardrobe built facing +z
  function wardrobe(wd, h, d, x, z, rotY, body, doors) {
    const g = group(x, 0, z, rotY);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.02, 0.015, 0.06, gold, sx * (wd / 2 - 0.06), 0.03, sz * (d / 2 - 0.06), g);
    soft(wd, h - 0.06, d, 0.02, body, 0, 0.06 + (h - 0.06) / 2, 0, g);
    soft(wd + 0.04, 0.04, d + 0.03, 0.012, body, 0, h + 0.02, 0, g);
    for (const s of [-1, 1]) {
      const dx = s * wd / 4, cy = 0.06 + (h - 0.06) / 2;
      soft(wd / 2 - 0.03, h - 0.16, 0.02, 0.008, doors, dx, cy, d / 2 + 0.006, g);
      for (const f of [0.3, 0.7]) soft(wd / 2 - 0.15, (h - 0.2) * 0.33, 0.012, 0.005, body, dx, 0.08 + (h - 0.1) * f, d / 2 + 0.018, g);
      ball(0.02, gold, s * 0.05, cy, d / 2 + 0.03, g);
    }
    add(new THREE.ShapeGeometry(heartShape(0.1), 16), paint(0xf48fb1), 0, h - 0.08, d / 2 + 0.017, g);
    return g;
  }

  // a door leaf hung at (hx, hz), swung open to rotY; its width runs along local +x
  const leafMat = paint(0xf9c9d6), leafPanel = paint(0xfbdde6);
  function doorLeaf(hx, hz, wd, rotY) {
    const g = group(hx, 0, hz, rotY);
    soft(wd - 0.02, DOOR_H - 0.02, 0.04, 0.01, leafMat, wd / 2, DOOR_H / 2, 0, g);
    for (const y of [0.55, 1.4]) for (const s of [-1, 1]) soft(wd - 0.3, 0.6, 0.012, 0.004, leafPanel, wd / 2, y, s * 0.024, g);
    for (const s of [-1, 1]) {
      ball(0.028, gold, wd - 0.1, 1.0, s * 0.045, g);
      const h = add(new THREE.ShapeGeometry(heartShape(0.16), 24), paint(0xf48fb1), wd / 2, 1.88, s * 0.023, g);
      if (s < 0) h.rotation.y = Math.PI;
    }
  }
  doorLeaf(HALL_DOOR[0] + 0.02, ZM + T / 2, HALL_DOOR[1] - HALL_DOOR[0] - 0.02, -Math.PI / 2 + 0.12);   // swung into the bedroom
  doorLeaf(DOOR5[0] + 0.02, ZN - T / 2, DOOR5[1] - DOOR5[0] - 0.02, Math.PI / 2 - 0.12);               // door 5, also into the bedroom
  doorLeaf(XB + T / 2, KIDS_DOOR[0] + 0.02, KIDS_DOOR[1] - KIDS_DOOR[0] - 0.02, -0.12);                // into the kids' room

  // a table lamp: a pink gourd base and a dotty shade
  function tableLamp(x, y, z, power) {
    const g = group(x, y, z);
    add(turn([[0, 0], [0.06, 0], [0.085, 0.05], [0.08, 0.12], [0.04, 0.18], [0.02, 0.22], [0, 0.22]], 32), paint(0xf7a8c4), 0, 0, 0, g);
    cyl(0.006, 0.006, 0.08, gold, 0, 0.25, 0, g);
    const shade = shadeMat(0xffffff, dotsTex('#ffffff', '#f7b9c8', 4, 1)), bulb = bulbMat();
    add(new THREE.CylinderGeometry(0.1, 0.15, 0.17, 40, 1, true), shade, 0, 0.33, 0, g);
    ball(0.03, bulb, 0, 0.29, 0, g);
    lamp(x, y + 0.3, z, { hit: [0.2, y + 0.42], shades: [shade], bulb, power, distance: 4 });
  }

  // ---------- living room (top left of the sketch) ----------
  {
    // the Melody rug, the right way up from the TV end
    const rx = 2.6, rz = 2.0, rw = 2.5, rd = 1.8;
    soft(rw, 0.014, rd, 0.007, mat(0xf4a6bf), rx, 0.007, rz).castShadow = false;
    const top = add(new THREE.PlaneGeometry(rw - 0.02, rd - 0.02), mat(0xffffff, rugTex, { roughness: 1 }), rx, 0.0145, rz);
    top.rotation.x = -Math.PI / 2;
    top.castShadow = false;
    fluff([top], { length: 0.01, layers: 8, strand: 0.0035, curl: 0.3, shade: 0.8, uvSize: [rw, rd] });
  }
  {
    // 22: the sofa against the south wall, facing the TV
    const s = sofa(2.0, 0.92, 2.7, 0.5, 0, velvet(0xf7b6c8));
    faceCushion(melodyCushionTex, 0.36, -0.45, s.sit + 0.17, s.front - 0.04, s.g);
    const heart = add(puffed(heartShape(0.34), 0.05, 0.035), velvet(0xffffff), 0.45, s.sit + 0.17, s.front - 0.04, s.g);
    heart.rotation.x = -0.2;
    // 25: the loveseat under the east window, facing west into the room
    const l = sofa(1.5, 0.88, 0.48, 2.0, Math.PI / 2, velvet(0xfbd3df));
    faceCushion(melodyCushionTex, 0.32, 0.2, l.sit + 0.16, l.front - 0.04, l.g);
    const star = add(puffed(starShape(0.15, 0.52), 0.05, 0.03), velvet(0xfbe7a6), -0.3, l.sit + 0.15, l.front - 0.04, l.g);
    star.rotation.x = -0.2;
  }
  {
    // 26: the coffee table, a tea set for two and a bowl of strawberries
    const cx = 2.7, cz = 1.75, ty = 0.42;
    slab(1.0, 0.04, 0.56, 0.2, [paint(P.white), paint(P.pink)], cx, ty, cz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.022, 0.015, ty, gold, cx + sx * 0.4, ty / 2, cz + sz * 0.2);
    const t = ty + 0.04;
    for (const [dx, dz] of [[-0.25, 0.08], [0.2, -0.1]]) {
      add(turn([[0, 0], [0.06, 0], [0.075, 0.008], [0, 0.008]]), porcelain, cx + dx, t, cz + dz);
      add(turn([[0, 0], [0.03, 0], [0.042, 0.05], [0.04, 0.055], [0.036, 0.052], [0, 0.01]]), paint(0xf7a8c4), cx + dx, t + 0.008, cz + dz);
    }
    add(turn([[0, 0], [0.05, 0], [0.09, 0.04], [0.085, 0.045], [0, 0.01]]), porcelain, cx + 0.05, t, cz + 0.1);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = 0.03 + (i % 3) * 0.015;
      ball(1, mat(0xe0324d, null, { roughness: 0.35 }), cx + 0.05 + Math.cos(a) * r, t + 0.04 + (i % 2) * 0.012, cz + 0.1 + Math.sin(a) * r, root, 0.02, 0.024, 0.02);
    }
  }
  {
    // 23 and 24: the TV on its stand against the north wall, facing the sofa, toys tucked underneath
    const g = group(2.45, 0, ZL - 0.23, Math.PI), wd = 1.8, d = 0.42, h = 0.5, body = paint(P.white), front = paint(P.pink);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.02, 0.014, 0.08, gold, sx * (wd / 2 - 0.08), 0.04, sz * (d / 2 - 0.06), g);
    soft(wd, 0.04, d, 0.012, body, 0, h - 0.02, 0, g);
    soft(wd, 0.04, d, 0.012, body, 0, 0.1, 0, g);
    soft(wd - 0.04, h - 0.12, 0.02, 0.006, body, 0, 0.08 + (h - 0.12) / 2 + 0.02, -d / 2 + 0.012, g);
    for (const s of [-1, 1]) {
      const bx = s * (wd / 2 - 0.25);
      soft(0.5, h - 0.1, d, 0.012, body, bx, 0.08 + (h - 0.1) / 2, 0, g);
      for (const y of [0.2, 0.355]) {
        soft(0.46, 0.13, 0.02, 0.008, front, bx, y, d / 2 + 0.004, g);
        ball(0.015, gold, bx, y, d / 2 + 0.02, g);
      }
    }
    // in the open middle, under the TV: a little Melody, a stack of blocks and a ball
    melodyToy(-0.22, 0.12, 0.02, 0, 0.6, g);
    [[0xfbd3df, 0.12, 0.05], [0xbfe6d6, 0.2, -0.04], [0xfbe7a6, 0.15, 0.02]].forEach(([c, x, z], i) => {
      const b = box(0.07, 0.07, 0.07, paint(c), x, 0.155 + (i === 2 ? 0.07 : 0), z, g);
      b.rotation.y = i * 0.4;
    });
    ball(0.06, paint(0xf48fb1), 0.33 - 0.02, 0.18, 0.04, g);
    // TV
    soft(0.36, 0.02, 0.2, 0.008, paint(0x3a3a40), 0, h + 0.01, -0.03, g);
    cyl(0.022, 0.022, 0.16, chrome, 0, h + 0.09, -0.05, g);
    soft(1.3, 0.75, 0.045, 0.012, mat(0x1d1d22, null, { roughness: 0.3 }), 0, h + 0.53, -0.05, g);
    flat(1.26, 0.71, mat(0x07080b, null, { roughness: 0.06 }), 0, h + 0.53, -0.026, g);
    // and more toys on the floor in front, as drawn
    const toy = (c, x, z, ry) => { const b = box(0.08, 0.08, 0.08, paint(c), x, 0.04, z); b.rotation.y = ry; };
    toy(0xbfe6d6, 2.15, ZL - 0.62, 0.3); toy(0xfbd3df, 2.27, ZL - 0.58, -0.4); toy(0xfbe7a6, 2.2, ZL - 0.7, 0.9);
    melodyToy(2.95, 0, ZL - 0.6, Math.PI - 0.5, 0.8);
  }
  // a Melody print above the sofa, and a spotty-pot plant in the north-east corner
  picture(melodyPosterTex, 0.6, 0.8, 0.04, paint(P.pink), group(2.7, 1.65, 0.006));
  potPlant(0.38, 0, ZL - 0.38, 0.17, 0.32, mat(0xffffff, dotsTex('#ffffff', '#f4a6ba', 4, 2)), 15, 0.6, 0.22);

  // ---------- kitchen along the south wall (21): cooktop and hood at the east end, then the sink ----------
  {
    const x0 = 4.3, x1 = 7.1, L = x1 - x0, dep = 0.6, top = 0.9;
    const g = group((x0 + x1) / 2, 0, dep / 2 + 0.01);
    box(L, 0.08, dep - 0.06, paint(0xe9e2da), 0, 0.04, -0.03, g);
    soft(L, top - 0.12, dep - 0.02, 0.02, paint(P.pink), 0, 0.08 + (top - 0.12) / 2, -0.01, g);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const dx = (i + 0.5) * L / n - L / 2;
      soft(L / n - 0.03, top - 0.18, 0.02, 0.01, paint(P.white), dx, 0.08 + (top - 0.12) / 2, dep / 2 - 0.005, g);
      ball(0.017, gold, dx + (i % 2 ? -1 : 1) * (L / n / 2 - 0.07), top - 0.2, dep / 2 + 0.02, g);
      add(new THREE.ShapeGeometry(heartShape(0.1), 16), paint(0xf7a8c4), dx, 0.45, dep / 2 + 0.008, g);
    }
    soft(L + 0.02, 0.04, dep + 0.02, 0.012, mat(0xfefcf9, null, { roughness: 0.25 }), 0, top - 0.02, 0, g);
    const cx = -L / 2 + 0.45;
    box(0.6, 0.008, 0.48, mat(0x111114, null, { roughness: 0.08 }), cx, top + 0.004, 0, g);
    for (const dx of [-0.14, 0.14]) {
      const ring = add(new THREE.RingGeometry(0.065, 0.08, 40), mat(0x55555c, null, { roughness: 0.4 }), cx + dx, top + 0.009, 0.03, g);
      ring.rotation.x = -Math.PI / 2;
    }
    const kettle = group(cx + 0.14, top + 0.01, 0.03, 0, g);
    add(turn([[0, 0], [0.075, 0], [0.085, 0.06], [0.07, 0.13], [0.03, 0.155], [0, 0.16]]), paint(P.pink), 0, 0, 0, kettle);
    ball(0.016, paint(P.white), 0, 0.165, 0, kettle);
    add(new THREE.TorusGeometry(0.05, 0.009, 8, 24, Math.PI), paint(P.white), 0, 0.15, 0, kettle).rotation.y = Math.PI / 2;
    cyl(0.008, 0.016, 0.09, paint(P.pink), 0, 0.09, 0.09, kettle).rotation.x = 0.9;
    // the hood over the cooktop, drawn above it in the sketch: a canopy and a chimney to the ceiling
    const hoodMat = paint(0xfbd3df), back = -dep / 2 - 0.01;
    add(new THREE.CylinderGeometry(0.2, 0.45, 0.3, 4, 1).rotateY(Math.PI / 4), hoodMat, cx, 1.75, back + 0.33, g);
    soft(0.3, H - 1.9, 0.3, 0.01, hoodMat, cx, 1.9 + (H - 1.9) / 2, back + 0.15, g);
    box(0.62, 0.03, 0.62, gold, cx, 1.6, back + 0.33, g);
    // the sink, a gold swan-neck tap
    const sx = 0.6;
    soft(0.5, 0.012, 0.38, 0.05, mat(0xb9c2ca, null, { metalness: 0.8, roughness: 0.3 }), sx, top + 0.002, 0.02, g);
    soft(0.42, 0.006, 0.3, 0.04, mat(0x6e7780, null, { metalness: 0.8, roughness: 0.35 }), sx, top + 0.008, 0.02, g);
    cyl(0.015, 0.018, 0.25, gold, sx, top + 0.125, -0.22, g);
    add(new THREE.TorusGeometry(0.07, 0.012, 10, 24, Math.PI), gold, sx, top + 0.25, -0.15, g).rotation.y = Math.PI / 2;
    // an open shelf to the west of the hood: jars and plates
    const shelfY = 1.55;
    soft(1.4, 0.03, 0.22, 0.01, paint(P.white), 0.55, shelfY, back + 0.12, g);
    [[P.pink, 0.0], [0xffffff, 0.14], [P.butter, 0.28]].forEach(([c, x]) => {
      cyl(0.045, 0.045, 0.12, mat(0xfafcff, null, { roughness: 0.1 }), x, shelfY + 0.075, back + 0.12, g);
      cyl(0.048, 0.048, 0.025, paint(c), x, shelfY + 0.15, back + 0.12, g);
    });
    for (let i = 0; i < 4; i++) cyl(0.1, 0.08, 0.014, porcelain, 0.95, shelfY + 0.022 + i * 0.016, back + 0.12, g);
    melodyToy(1.12, shelfY + 0.015, back + 0.12, 0, 0.45, g);
  }

  // ---------- dining (20): a table for four, chairs 16 to 19 ----------
  {
    const cx = 7.4, cz = 2.8, tw = 0.9, td = 1.4, ty = 0.75;
    slab(tw, 0.045, td, 0.12, [paint(P.white), paint(P.white)], cx, ty - 0.045, cz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.03, 0.018, ty - 0.05, paint(P.white), cx + sx * (tw / 2 - 0.1), (ty - 0.05) / 2, cz + sz * (td / 2 - 0.12));
    for (const [sx, sz, color] of [[-1, -1, P.pink], [-1, 1, 0xffffff], [1, -1, 0xffffff], [1, 1, P.pink]]) {
      const px = cx + sx * 0.24, pz = cz + sz * 0.33;
      box(0.26, 0.004, 0.34, paint(color === P.pink ? 0xffffff : P.pink), px, ty + 0.002, pz);
      add(turn([[0, 0], [0.07, 0], [0.11, 0.012], [0.115, 0.016], [0.1, 0.014], [0, 0.006]]), porcelain, px, ty + 0.004, pz);
      chair(cx + sx * 0.66, pz, sx < 0 ? Math.PI / 2 : -Math.PI / 2, color);
    }
    const v = group(cx, ty, cz);
    add(turn([[0, 0], [0.035, 0], [0.045, 0.05], [0.025, 0.11], [0.03, 0.13]]), mat(0xfbd3df, null, { roughness: 0.15 }), 0, 0, 0, v);
    [[0.0, 0.32, 0xf47aa0], [0.05, 0.28, 0xffffff], [-0.045, 0.27, 0xf7a8bd]].forEach(([dx, h, c]) => {
      cyl(0.004, 0.004, h - 0.1, leafGreen, dx / 2, 0.1 + (h - 0.1) / 2, 0, v).rotation.z = -dx * 2;
      ball(1, paint(c), dx, h, 0, v, 0.022, 0.032, 0.022);
    });
  }

  // ---------- the hallway from the living room to the main bedroom ----------
  soft(0.8, 0.012, 1.2, 0.004, mat(0xffffff, dotsTex('#f9c6d4', '#ffffff', 2, 3)), (XH + XB) / 2, 0.006, (ZL + ZM) / 2).castShadow = false;
  picture(printTex, 0.36, 0.47, 0.03, paint(P.white), group(XH + 0.006, 1.55, (ZL + ZM) / 2, Math.PI / 2));

  // ---------- the main bedroom ----------
  // 2: the wardrobe on the east wall
  wardrobe(1.1, 2.0, 0.58, 0.31, 6.15, Math.PI / 2, paint(P.white), paint(P.pink));
  // 1: the bed, its padded arch headboard under the window
  {
    const g = group(0, 0, 7.7, Math.PI / 2), L = 2.05, Wd = 1.6, z0 = 0.12, mid = z0 + L / 2;
    const hb = new THREE.Shape();
    hb.moveTo(-0.84, 0); hb.lineTo(0.84, 0); hb.lineTo(0.84, 0.78);
    hb.bezierCurveTo(0.84, 1.2, -0.84, 1.2, -0.84, 0.78); hb.closePath();
    add(new THREE.ExtrudeGeometry(hb, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 24 }), velvet(0xf7b6c8), 0, 0.03, 0.04, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.025, 0.02, 0.08, gold, sx * (Wd / 2 - 0.04), 0.04, z0 + 0.06 + (sz + 1) / 2 * (L - 0.12), g);
    soft(Wd + 0.06, 0.26, L, 0.04, paint(P.white), 0, 0.08 + 0.13, mid, g);
    slab(Wd, 0.2, L - 0.04, 0.06, [cream, cream], 0, 0.34, mid, g);
    const mt = 0.54;
    const duvet = add(pillowGeo(Wd + 0.08, L * 0.66, 0.12), mat(0xffffff, melodyBedTex), 0, mt + 0.045, z0 + L - L * 0.33 - 0.01, g);
    const pillows = [-0.38, 0.38].map(x => {
      const p = add(pillowGeo(0.66, 0.42, 0.16), mat(0xffffff, dotsTex('#ffffff', '#f7b9c8', 2)), x, mt + 0.07, z0 + 0.3, g);
      p.rotation.x = 0.12;
      return p;
    });
    fluff([duvet], { length: 0.006, layers: 6, strand: 0.0018, shade: 0.85, uvSize: [Wd, L * 0.66] });
    fluff(pillows, { length: 0.006, layers: 6, strand: 0.0018, shade: 0.85, uvSize: [0.66, 0.42] });
    soft(Wd + 0.14, 0.03, 0.42, 0.012, mat(0xffffff, knitTex('#fbd3df', '#fde6ee', '#f2b3c6', 6, 2)), 0, mt + 0.115, z0 + L - 0.3, g);   // knit throw across the foot
    melodyToy(0.05, mt + 0.02, z0 + 0.62, 0, 1.0, g);
  }
  // 3: the bedside table and its lamp
  drawers(0.45, 0.55, 0.4, 2, 1, 0.24, 8.85, Math.PI / 2, paint(P.white), paint(P.pink));
  tableLamp(0.24, 0.55, 8.85, 1.0);
  // 4: the floor lamp, its cable running to a socket on the wall
  {
    const lx = 4.5, lz = 7.92, g = group(lx, 0, lz);
    cyl(0.13, 0.15, 0.025, paint(P.white), 0, 0.012, 0, g);
    cyl(0.015, 0.015, 1.4, gold, 0, 0.72, 0, g);
    const floorShade = shadeMat(0xf7b6c8), floorBulb = bulbMat();
    add(new THREE.CylinderGeometry(0.17, 0.22, 0.28, 48, 1, true), floorShade, 0, 1.5, 0, g);
    ball(0.04, floorBulb, 0, 1.44, 0, g);
    lamp(lx, 1.42, lz, { hit: [0.24, 1.66], shades: [floorShade], bulb: floorBulb, power: 1.4 });
    const wallX = XB - T / 2;
    flat(0.08, 0.08, paint(P.white), 0, 0, 0, group(wallX - 0.003, 0.3, lz + 0.18, -Math.PI / 2));
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(lx + 0.1, 0.006, lz), new THREE.Vector3(wallX - 0.08, 0.006, lz + 0.1),
      new THREE.Vector3(wallX - 0.015, 0.12, lz + 0.16), new THREE.Vector3(wallX - 0.015, 0.28, lz + 0.18),
    ]);
    add(new THREE.TubeGeometry(path, 40, 0.004, 6), paint(P.white), 0, 0, 0);
  }
  // 6: the desk with the laptop, against the bathroom wall
  {
    const g = group(XB - T / 2 - 0.28, 0, 8.75, -Math.PI / 2), top = 0.74;
    soft(1.1, 0.035, 0.55, 0.012, paint(P.white), 0, top, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.02, 0.016, top - 0.02, paint(P.pink), sx * 0.5, (top - 0.02) / 2, sz * 0.22, g);
    soft(0.5, 0.11, 0.48, 0.01, paint(P.white), 0.25, top - 0.08, 0, g);
    soft(0.46, 0.08, 0.02, 0.006, paint(P.pink), 0.25, top - 0.08, 0.245, g);
    ball(0.014, gold, 0.25, top - 0.08, 0.26, g);
    const s = top + 0.018, lap = group(-0.05, s, 0.04, 0, g), alu = mat(0xf2c9d4, null, { metalness: 0.6, roughness: 0.35 });
    soft(0.34, 0.016, 0.24, 0.006, alu, 0, 0.008, 0, lap);
    box(0.3, 0.002, 0.11, mat(0x3a3036, null, { roughness: 0.5 }), 0, 0.017, -0.04, lap);
    const lid = group(0, 0.016, -0.12, 0, lap);
    lid.rotation.x = -0.28;
    soft(0.34, 0.23, 0.012, 0.006, alu, 0, 0.115, 0, lid);
    flat(0.31, 0.2, mat(0x1b1d2a, null, { roughness: 0.15, emissive: 0x2a2f55, emissiveIntensity: 0.25 }), 0, 0.115, 0.0065, lid);
    add(new THREE.ShapeGeometry(heartShape(0.06), 16), paint(0xffffff), 0, 0.12, -0.0065, lid).rotation.y = Math.PI;
    const cup = group(0.38, s, -0.12, 0, g);
    cyl(0.04, 0.036, 0.1, paint(P.pink), 0, 0.05, 0, cup);
    [[0xffffff, 0.012, 0.012, 0.15], [0xfbe7a6, -0.012, 0.01, -0.1], [0xf7a8bd, 0.016, -0.006, 0.2]].forEach(([c, x, z, lean]) => {
      cyl(0.004, 0.004, 0.17, paint(c), x, 0.11, z, cup).rotation.set(lean, 0, -lean * 0.6);
    });
    chair(XB - T / 2 - 0.85, 8.75, Math.PI / 2, P.white);
  }
  {
    // a fluffy round rug by the bed, a print, and a plant by door 5
    const rug = add(new THREE.CircleGeometry(0.85, 48), mat(0xffffff, dotsTex('#fbd3df', '#ffffff', 3)), 2.9, 0.012, 7.7);
    rug.rotation.x = -Math.PI / 2;
    rug.castShadow = false;
    fluff([rug], { length: 0.012, layers: 8, strand: 0.004, curl: 0.4, shade: 0.75, uvSize: [1.7, 1.7] });
    picture(melodyPosterTex, 0.5, 0.67, 0.035, paint(P.pink), group(2.0, 1.6, ZM + 0.006));
    potPlant(0.4, 0, ZN - 0.38, 0.19, 0.34, mat(0xffffff, dotsTex('#ffffff', '#f4a6ba', 4, 2)), 15, 0.6, 0.22);
  }

  // ---------- the big bathroom ----------
  // pink-and-white tiles to shoulder height round the vanity and the toilet room; full height in the shower
  {
    const wallTile = (len, x, z, rotY, th = 1.25) => {
      const m = add(new THREE.PlaneGeometry(len, th), mat(0xffffff, tileTex(len / 0.6, th / 0.6), { roughness: 0.2 }), x, th / 2, z);
      m.rotation.y = rotY;
      m.castShadow = false;
    };
    const fz = ZM + T / 2 + 0.004, fx = XB + T / 2 + 0.004, nz = ZN - T / 2 - 0.004;
    wallTile(7.56 - (XB + T / 2), (XB + T / 2 + 7.56) / 2, fz, 0);
    wallTile(EN_SUITE[0] - 0.07 - (ZM + T / 2), fx, (ZM + T / 2 + EN_SUITE[0] - 0.07) / 2, Math.PI / 2);
    wallTile(nz - EN_SUITE[1] - 0.07, fx, (EN_SUITE[1] + 0.07 + nz) / 2, Math.PI / 2);
    wallTile(6.46 - (XB + T / 2), (XB + T / 2 + 6.46) / 2, nz, Math.PI);
    wallTile(ZN - T / 2 - 8.3, 6.456, (8.3 + ZN - T / 2) / 2, -Math.PI / 2);
    wallTile(7.56 - 6.54, (6.54 + 7.56) / 2, nz, Math.PI, 2.1);
    wallTile(ZN - T / 2 - 8.3, 6.544, (8.3 + ZN - T / 2) / 2, Math.PI / 2, 2.1);
  }
  // 14: the vanity along the south wall: the basin, a floss box on its left, toothbrushes on its right
  {
    const x0 = 5.32, x1 = 7.48, L = x1 - x0, dep = 0.55, top = 0.86, wallZ = ZM + T / 2;
    const g = group((x0 + x1) / 2, 0, wallZ + dep / 2);
    box(L - 0.04, 0.08, dep - 0.06, paint(0xe9e2da), 0, 0.04, -0.03, g);
    soft(L, top - 0.12, dep - 0.02, 0.02, paint(P.pink), 0, 0.08 + (top - 0.12) / 2, -0.01, g);
    for (let i = 0; i < 3; i++) {
      const dx = (i + 0.5) * L / 3 - L / 2;
      soft(L / 3 - 0.03, top - 0.18, 0.02, 0.01, paint(P.white), dx, 0.08 + (top - 0.12) / 2, dep / 2 - 0.005, g);
      ball(0.017, gold, dx, top - 0.2, dep / 2 + 0.02, g);
    }
    soft(L + 0.02, 0.04, dep + 0.02, 0.012, mat(0xffffff, null, { roughness: 0.15 }), 0, top - 0.02, 0, g);
    add(turn([[0, 0], [0.1, 0], [0.18, 0.04], [0.21, 0.12], [0.2, 0.13], [0.17, 0.07], [0.09, 0.02], [0, 0.02]], 48), porcelain, 0, top, 0.03, g);
    const tap = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, top, -0.2), new THREE.Vector3(0, top + 0.3, -0.2), new THREE.Vector3(0, top + 0.34, -0.14), new THREE.Vector3(0, top + 0.28, -0.07),
    ]);
    add(new THREE.TubeGeometry(tap, 30, 0.012, 10), gold, 0, 0, 0, g);
    soft(0.08, 0.035, 0.06, 0.012, paint(0xbfe6d6), -0.55, top + 0.0175, 0.02, g);          // the floss box
    soft(0.082, 0.012, 0.062, 0.005, paint(P.white), -0.55, top + 0.04, 0.02, g);
    const cup = group(0.55, top, 0.0, 0, g);                                                // the toothbrush cup
    add(turn([[0, 0], [0.035, 0], [0.04, 0.1], [0.036, 0.1], [0.031, 0.006], [0, 0.006]], 32), paint(0xf7a8c4), 0, 0, 0, cup);
    [[0xffffff, 0.2], [0xbfe6d6, -0.25]].forEach(([c, lean], i) => {
      const b = group((i - 0.5) * 0.02, 0.02, 0, 0, cup);
      b.rotation.z = lean;
      cyl(0.006, 0.005, 0.17, paint(c), 0, 0.085, 0, b);
      box(0.012, 0.025, 0.016, paint(0xffffff), 0, 0.18, 0.006, b);
    });
    // the mirror above: a rounded panel with bunny ears, framed in gold
    const mg = group(0, 1.6, -dep / 2 + 0.004, 0, g), mirrorMat = mat(0xdfe6ee, null, { metalness: 1, roughness: 0.04 });
    const rr = (wd, h, r) => {
      const s = new THREE.Shape(), a = -wd / 2, b = -h / 2;
      s.moveTo(a + r, b); s.lineTo(a + wd - r, b); s.quadraticCurveTo(a + wd, b, a + wd, b + r);
      s.lineTo(a + wd, b + h - r); s.quadraticCurveTo(a + wd, b + h, a + wd - r, b + h);
      s.lineTo(a + r, b + h); s.quadraticCurveTo(a, b + h, a, b + h - r); s.lineTo(a, b + r); s.quadraticCurveTo(a, b, a + r, b);
      return s;
    };
    const oval = (rx, ry) => { const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2); return s; };
    add(new THREE.ShapeGeometry(rr(0.86, 0.72, 0.2), 16), gold, 0, 0, 0, mg);
    add(new THREE.ShapeGeometry(rr(0.8, 0.66, 0.17), 16), mirrorMat, 0, 0, 0.003, mg);
    for (const s of [-1, 1]) {
      add(new THREE.ShapeGeometry(oval(0.08, 0.2), 24), gold, s * 0.2, 0.5, -0.001, mg);
      add(new THREE.ShapeGeometry(oval(0.05, 0.16), 24), paint(0xf7a8c4), s * 0.2, 0.5, 0.002, mg);
    }
    // a pair of wall lights either side of the mirror: the bathroom has no window, so these are its clickable lamp
    const sconceShade = shadeMat(0xffffff, dotsTex('#ffffff', '#fbd3df', 3, 1)), sconceBulb = bulbMat();
    for (const s of [-1, 1]) {
      const sc = group(s * 0.62, 1.62, -dep / 2 + 0.004, 0, g);
      cyl(0.04, 0.04, 0.012, gold, 0, 0, 0.006, sc).rotation.x = Math.PI / 2;
      cyl(0.008, 0.008, 0.1, gold, 0, 0, 0.06, sc).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.06, 0.085, 0.14, 32, 1, true), sconceShade, 0, 0.03, 0.11, sc);
      ball(0.025, sconceBulb, 0, 0.0, 0.11, sc);
    }
    lamp((x0 + x1) / 2, 1.62, wallZ + 0.36, { hit: [0.3, 2.0], shades: [sconceShade], bulb: sconceBulb, power: 1.3, distance: 4.5 });
  }
  // 15: the toilet room. A small basin on the wall with its tap on the wall side, the toilet
  // against the north wall facing south, and the paper holder with a roll on the side wall.
  {
    const g = group(XB + T / 2, 0, 8.65, Math.PI / 2);
    soft(0.46, 0.16, 0.36, 0.06, porcelain, 0, 0.78, 0.18, g);
    slab(0.36, 0.01, 0.24, 0.08, [mat(0xe9eef2, null, { roughness: 0.1 }), porcelain], 0, 0.855, 0.2, g);
    cyl(0.012, 0.014, 0.12, gold, 0, 0.92, 0.04, g);
    cyl(0.009, 0.009, 0.08, gold, 0, 0.97, 0.08, g).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) ball(0.018, gold, s * 0.07, 0.9, 0.04, g);
    const mirror = group(0, 1.5, 0.006, 0, g);
    add(new THREE.TorusGeometry(0.22, 0.02, 12, 56), gold, 0, 0, 0.015, mirror);
    flat(0.4, 0.4, mat(0xdfe6ee, null, { metalness: 1, roughness: 0.04 }), 0, 0, 0.004, mirror).geometry = new THREE.CircleGeometry(0.215, 56);
  }
  {
    const g = group(5.76, 0, ZN - T / 2 - 0.36, Math.PI);
    add(turn([[0.11, 0], [0.13, 0.02], [0.12, 0.2], [0.17, 0.36], [0.19, 0.4], [0, 0.4]], 40), porcelain, 0, 0, 0.04, g).scale.z = 1.3;
    const seat = add(new THREE.TorusGeometry(0.15, 0.03, 12, 40), paint(P.pink), 0, 0.42, 0.06, g);
    seat.rotation.x = Math.PI / 2; seat.scale.y = 1.25;
    soft(0.4, 0.36, 0.16, 0.05, porcelain, 0, 0.62, -0.24, g);
    ball(0.022, gold, 0.1, 0.81, -0.24, g);
    const holder = group(6.5 - 0.04, 0.7, 9.25, -Math.PI / 2);
    soft(0.16, 0.05, 0.01, 0.004, gold, 0, 0, 0.005, holder);
    for (const s of [-1, 1]) cyl(0.006, 0.006, 0.07, gold, s * 0.07, 0, 0.04, holder).rotation.x = Math.PI / 2;
    cyl(0.004, 0.004, 0.15, gold, 0, -0.01, 0.07, holder).rotation.z = Math.PI / 2;
    const roll = add(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 32), mat(0xffffff, null, { roughness: 1 }), 0, -0.02, 0.075, holder);
    roll.rotation.z = Math.PI / 2;
    flat(0.1, 0.12, mat(0xffffff, null, { roughness: 1, side: THREE.DoubleSide }), 0.0, -0.13, 0.13, holder);   // the end hanging down
  }
  // the shower, in the space between the toilet room and the closets: a tray, tinted
  // glass with a frosted band, gold frames, a hinged door, and a rain head
  {
    const x0 = 6.56, x1 = 7.54, z0 = 8.97, z1 = ZN - T / 2;
    slab(x1 - x0, 0.06, z1 - z0, 0.04, [porcelain, porcelain], (x0 + x1) / 2, 0, (z0 + z1) / 2);
    cyl(0.03, 0.03, 0.004, chrome, (x0 + x1) / 2, 0.062, (z0 + z1) / 2);
    const glassTint = new THREE.MeshPhysicalMaterial({ color: 0xf3d6e0, roughness: 0.08, transparent: true, opacity: 0.34, envMapIntensity: 2.5, side: THREE.DoubleSide, depthWrite: false });
    const frost = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const gh = 1.95, gy = 0.06 + gh / 2;
    const glassPanel = (wd, cx, cz, rotY, parent) => {
      const g = group(cx, gy, cz, rotY, parent);
      for (const [geo, m, y] of [[new THREE.PlaneGeometry(wd, gh), glassTint, 0], [new THREE.PlaneGeometry(wd - 0.03, 0.3), frost, 0.08]]) {
        const pane = add(geo, m, 0, y, 0, g);
        pane.castShadow = false;
        hideFromAO.push(pane);
      }
      for (const sgn of [-1, 1]) {
        soft(0.022, gh, 0.022, 0.006, gold, sgn * wd / 2, 0, 0, g);
        soft(wd, 0.022, 0.022, 0.006, gold, 0, sgn * gh / 2, 0, g);
      }
      return g;
    };
    const fixed = 0.3, doorW = x1 - x0 - fixed;
    glassPanel(fixed, x0 + fixed / 2, z0, 0);
    glassPanel(9.2 - z0, x1, (z0 + 9.2) / 2, Math.PI / 2);
    const hinge = group(x0 + fixed, 0, z0, 0.4);
    glassPanel(doorW, doorW / 2, 0, 0, hinge);
    for (const sgn of [-1, 1]) soft(0.018, 0.32, 0.018, 0.006, gold, doorW - 0.07, gy, sgn * 0.035, hinge);
    const cx = (x0 + x1) / 2;
    cyl(0.012, 0.012, 2.0, chrome, cx, 1.0, z1 - 0.04);
    cyl(0.12, 0.12, 0.02, chrome, cx, 2.05, z1 - 0.2);
    cyl(0.01, 0.01, 0.16, chrome, cx, 2.05, z1 - 0.11).rotation.x = Math.PI / 2;
    soft(0.28, 0.02, 0.1, 0.006, chrome, cx, 1.1, z1 - 0.05);
    [[0xf7a8c4, 0.16], [0xffffff, 0.13], [0xfbe7a6, 0.18]].forEach(([c, h], i) => soft(0.06, h, 0.05, 0.02, paint(c), cx - 0.09 + i * 0.08, 1.11 + h / 2, z1 - 0.05));
  }
  // 13 and 12: the two walk-in closets along the west wall, each a rail of clothes and a mirror
  {
    const garments = [0xf7b6c8, 0xffffff, 0xfbd3df, 0xd9c8f0, 0xfbe7a6, 0xf48fb1, 0xc6e2f5, 0xfde6ee];
    const rail = (x0, x1, z) => {
      const r = cyl(0.012, 0.012, x1 - x0, gold, (x0 + x1) / 2, 1.8, z);
      r.rotation.z = Math.PI / 2;
      let x = x0 + 0.08, i = 0;
      while (x < x1 - 0.06) {
        const len = 0.7 + rand() * 0.35, c = garments[i % garments.length];
        add(new THREE.TorusGeometry(0.018, 0.003, 6, 16, Math.PI), gold, x, 1.795, z).rotation.y = Math.PI / 2;
        soft(0.035, len, 0.44, 0.015, paint(c), x, 1.76 - len / 2, z, root);
        x += 0.065 + rand() * 0.035; i++;
      }
    };
    rail(7.68, XE - 0.06, 7.72);
    rail(7.68, XE - 0.06, ZN - T / 2 - 0.26);
    const mirrorMat = mat(0xdfe6ee, null, { metalness: 1, roughness: 0.04 });
    // 13's mirror is a diamond, as drawn
    const dm = group(XE - 0.004, 1.3, 6.75, -Math.PI / 2);
    const diamond = r => { const s = new THREE.Shape(); s.moveTo(0, r * 1.2); s.lineTo(r, 0); s.lineTo(0, -r * 1.2); s.lineTo(-r, 0); s.closePath(); return s; };
    add(new THREE.ShapeGeometry(diamond(0.46)), gold, 0, 0, 0, dm);
    add(new THREE.ShapeGeometry(diamond(0.42)), mirrorMat, 0, 0, 0.003, dm);
    // 12's mirror is a tall rectangle
    const rm = group(XE - 0.004, 1.0, 8.6, -Math.PI / 2);
    flat(0.62, 1.62, gold, 0, 0, 0, rm);
    flat(0.56, 1.56, mirrorMat, 0, 0, 0.003, rm);
    // a fluffy pouf in the first closet, to sit and put shoes on
    const pouf = add(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 40), velvet(0xf7b6c8), 8.55, 0.19, 6.85);
    fluff([pouf], { length: 0.012, layers: 8, strand: 0.004, curl: 0.4, shade: 0.75 });
  }

  // ---------- the little hall between door 5 and the kids' room ----------
  soft(0.8, 0.012, 1.0, 0.004, mat(0xffffff, dotsTex('#f9c6d4', '#ffffff', 2, 3)), (XH2 + XB) / 2, 0.006, (ZN + ZH2) / 2).castShadow = false;
  {
    const hooks = group(XH2 + 0.004, 1.6, (ZN + ZH2) / 2, Math.PI / 2);
    soft(0.6, 0.08, 0.02, 0.01, paint(P.white), 0, 0, 0.01, hooks);
    for (const x of [-0.2, 0, 0.2]) ball(0.022, gold, x, -0.01, 0.045, hooks);
    soft(0.26, 0.3, 0.1, 0.05, paint(0xf7a8c4), -0.2, -0.2, 0.08, hooks);     // a little backpack
  }

  // ---------- the kids' room ----------
  // 10: the table against the south wall, with a desk lamp, crayons and a sketchbook; a Melody print above
  {
    const wallZ = ZN + T / 2, top = 0.62, g = group(6.7, 0, wallZ + 0.28);
    soft(1.3, 0.035, 0.52, 0.012, paint(P.white), 0, top, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.022, 0.018, top - 0.02, paint(P.pink), sx * 0.6, (top - 0.02) / 2, sz * 0.2, g);
    const s = top + 0.018;
    soft(0.3, 0.012, 0.22, 0.004, paint(0xffffff), -0.15, s + 0.006, 0.08, g).rotation.y = 0.15;
    const cup = group(0.15, s, -0.1, 0, g);
    cyl(0.04, 0.036, 0.09, paint(0xbfe6d6), 0, 0.045, 0, cup);
    [[0xf47aa0, 0.01, 0.01, 0.12], [0xfbe7a6, -0.012, 0.008, -0.14], [0xc6e2f5, 0.0, -0.014, 0.05], [0xd9c8f0, 0.016, -0.006, 0.2]].forEach(([c, x, z, lean]) => {
      cyl(0.005, 0.005, 0.13, paint(c), x, 0.09, z, cup).rotation.set(lean, 0, -lean * 0.6);
    });
    // the desk lamp: base, two arms and a pink cone, in the room's clickable lamps
    const lampMat = paint(0xf7a8bd), dl = group(0.45, s, -0.08, 0, g);
    cyl(0.06, 0.07, 0.02, lampMat, 0, 0.01, 0, dl);
    cyl(0.009, 0.009, 0.3, lampMat, -0.05, 0.16, 0, dl).rotation.z = 0.35;
    cyl(0.009, 0.009, 0.26, lampMat, -0.17, 0.33, 0, dl).rotation.z = -1.0;
    ball(0.016, gold, -0.1, 0.3, 0, dl);
    const deskShade = shadeMat(0xf7a8bd), deskBulb = bulbMat();
    add(turn([[0.07, 0], [0.065, 0.02], [0.03, 0.08], [0.016, 0.09]], 32), deskShade, -0.29, 0.36, 0, dl).rotation.z = 2.2;
    ball(0.022, deskBulb, -0.27, 0.33, 0, dl);
    dl.updateWorldMatrix(true, false);
    const glowAt = root.worldToLocal(dl.localToWorld(new THREE.Vector3(-0.27, 0.3, 0)));
    lamp(glowAt.x, glowAt.y, glowAt.z, { hit: [0.2, s + 0.5], shades: [deskShade], bulb: deskBulb, power: 0.6, distance: 3 });
    chair(6.7, wallZ + 0.85, Math.PI, P.pink, 0.8);
    picture(melodyPosterTex, 0.6, 0.8, 0.04, paint(P.white), group(6.7, 1.6, wallZ + 0.006));
  }
  // 9: the bunk bed against the west wall, pillows at the south end, ladder at the north end
  {
    const bw = 1.0, bl = 2.05, g = group(XE - 0.56, 0, ZN + T / 2 + 1.12), frame = paint(P.white), accent = paint(P.pink);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) soft(0.07, 1.9, 0.07, 0.015, frame, sx * (bw / 2 + 0.02), 0.95, sz * (bl / 2 + 0.02), g);
    const bedding = [], pillows = [];
    for (const [y0, k] of [[0.28, 0.75], [1.32, 1.0]]) {
      for (const sz of [-1, 1]) soft(bw + 0.04, 0.12, 0.05, 0.012, frame, 0, y0, sz * (bl / 2 + 0.02), g);
      for (const sx of [-1, 1]) soft(0.05, 0.12, bl, 0.012, frame, sx * (bw / 2 + 0.02), y0, 0, g);
      box(bw, 0.025, bl, oak, 0, y0 + 0.02, 0, g);
      slab(bw - 0.04, 0.15, bl - 0.04, 0.05, [cream, cream], 0, y0 + 0.035, 0, g);
      const mt = y0 + 0.185;
      bedding.push(add(pillowGeo(bw + 0.02, bl * 0.66, 0.11), mat(0xffffff, melodyBedTex), 0, mt + 0.04, bl / 2 - bl * 0.33 - 0.02, g));
      pillows.push(add(pillowGeo(0.6, 0.36, 0.14), mat(0xffffff, dotsTex('#ffffff', '#f7b9c8', 2)), 0, mt + 0.06, -bl / 2 + 0.26, g));
      melodyToy(-0.12, mt + 0.02, -bl / 2 + 0.58, -Math.PI / 2 + 0.3, k, g);
      for (const sz of [-1, 1]) soft(bw, 0.42, 0.03, 0.012, accent, 0, y0 + 0.3, sz * (bl / 2 + 0.02), g);   // pink end boards
    }
    fluff(bedding, { length: 0.006, layers: 6, strand: 0.0018, shade: 0.85, uvSize: [bw, bl * 0.66] });
    fluff(pillows, { length: 0.006, layers: 6, strand: 0.0018, shade: 0.85, uvSize: [0.6, 0.36] });
    // guard rails round the top bunk, open on the east side at the ladder
    const railY = 1.72, ex = -(bw / 2 + 0.02);
    soft(0.04, 0.05, bl, 0.01, frame, -ex, railY, 0, g);
    soft(0.04, 0.05, bl - 0.55, 0.01, frame, ex, railY, -0.275, g);
    for (let z = -bl / 2 + 0.3; z < bl / 2 - 0.6; z += 0.3) soft(0.03, railY - 1.38, 0.03, 0.008, frame, ex, (railY + 1.38) / 2, z, g);
    const lz0 = bl / 2 - 0.5, lz1 = bl / 2 - 0.08, lx = ex - 0.06;
    for (const z of [lz0, lz1]) soft(0.05, railY, 0.05, 0.01, frame, lx, railY / 2, z, g);
    for (let y = 0.3; y < 1.5; y += 0.3) soft(0.07, 0.04, lz1 - lz0, 0.01, accent, lx, y, (lz0 + lz1) / 2, g);
  }
  // 7 and 8: two wardrobes side by side on the north wall
  wardrobe(0.8, 1.75, 0.52, 7.25, ZK - 0.28, Math.PI, paint(P.white), paint(P.pink));
  wardrobe(0.8, 1.75, 0.52, 8.1, ZK - 0.28, Math.PI, paint(P.white), paint(0xfbd3df));
  {
    // a round Melody rug in the middle of the room
    const rug = add(new THREE.CircleGeometry(0.8, 64), mat(0xffffff, melodyRoundTex, { roughness: 1 }), 6.9, 0.012, 12.15);
    rug.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    rug.castShadow = false;
    fluff([rug], { length: 0.01, layers: 8, strand: 0.0035, curl: 0.3, shade: 0.8, uvSize: [1.6, 1.6] });
  }


  // Almost nothing in the room moves. Fold every mesh that shares a material into one
  // world-space mesh (hundreds of draw calls become a few dozen), then freeze
  // all transforms.
  scene.updateMatrixWorld(true);
  {
    const special = new Set(hideFromAO), buckets = new Map();
    scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.renderOrder !== 0 || windCurtains.includes(o)) return;
      for (let p = o; p; p = p.parent) if (special.has(p)) return;
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    });
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const parts = meshes.map(m => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        return g.applyMatrix4(m.matrixWorld);
      });
      const merged = new THREE.Mesh(mergeGeometries(parts), meshes[0].material);
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      scene.add(merged);
      meshes.forEach(m => m.removeFromParent());
      parts.forEach(g => g.dispose());
    }
  }
  scene.updateMatrixWorld(true);
  scene.traverse(o => { o.matrixAutoUpdate = false; });

  // The beams of light in the air are worked out in the pipeline by walking each
  // view ray through the home and asking, step by step, "can this point see the
  // sun?". That needs a depth picture of the home taken from the sun, and a map
  // of where, seen from above, the air is indoors: the courtyards must stay clear.
  const sunCam = new THREE.OrthographicCamera(sunBox.left, sunBox.right, sunBox.top, sunBox.bottom, sunBox.near, sunBox.far);
  const sunDepth = new THREE.WebGLRenderTarget(1024, 1024, { depthTexture: new THREE.DepthTexture(1024, 1024) });
  const solid = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const MASK_X0 = -DEEP, CELL = 0.1;
  const indoorMask = (() => {
    const nx = Math.round((XE - MASK_X0) / CELL), nz = Math.round(ZK / CELL), data = new Uint8Array(nx * nz * 4);
    const inPlan = (x, z) => {
      let inside = false;
      for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
        const [xi, zi] = footprint[i], [xj, zj] = footprint[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    const reveals = [[-DEEP, 0, LIVING_WIN], [-DEEP, 0, BED_WIN], [XB - DEEP, XB, KIDS_WIN]];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = MASK_X0 + (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      const on = inPlan(x, z) || reveals.some(([a, b, [z0, z1]]) => x > a && x < b && z > z0 && z < z1);
      data.fill(on ? 255 : 0, (j * nx + i) * 4, (j * nx + i) * 4 + 4);
    }
    const t = new THREE.DataTexture(data, nx, nz);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();
  const volumetric = {
    sunDepth: sunDepth.depthTexture,
    sunMatrix: new THREE.Matrix4(),
    sunDir,
    color: new THREE.Color(),
    density: 0.17,
    boxMin: new THREE.Vector3(MASK_X0 - CX, 0, -CZ),       // the home, including the window reveals
    boxMax: new THREE.Vector3(XE - CX, H, ZK - CZ),
    mask: indoorMask,
  };
  function renderSunDepth() {
    sunCam.position.copy(sun.position);
    sunCam.lookAt(sun.target.position);
    sunCam.updateMatrixWorld(true);
    const hidden = [...hideFromAO, ...windCurtains], was = hidden.map(o => o.visible);
    const bg = scene.background, auto = renderer.autoClear;
    hidden.forEach(o => { o.visible = false; });               // glass and the view outside do not block light
    scene.overrideMaterial = solid;
    scene.background = null;
    renderer.setRenderTarget(sunDepth);
    renderer.clear();
    renderer.render(scene, sunCam);
    scene.overrideMaterial = null;
    scene.background = bg;
    hidden.forEach((o, i) => { o.visible = was[i]; });
    renderer.autoClear = false;                                // then the blowing curtains, with their motion
    for (const c of windCurtains) {
      const own = c.material;
      c.material = blownMask;
      renderer.render(c, sunCam);
      c.material = own;
    }
    renderer.autoClear = auto;
    renderer.setRenderTarget(null);
    volumetric.sunMatrix.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
  }

  // Put the sun where it is `minutes` after sunrise (negative = before) and set
  // every light, the sky and the beams to match. Colours are linear RGB.
  const { lerp, smoothstep: ramp, DEG2RAD } = THREE.MathUtils;
  const blend = (out, a, b, t) => out.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
  const landBase = new THREE.Color(0x7a8348);
  function setSun(minutes) {
    const el = 0.183 * minutes, az = 1.5 + 0.17 * minutes;                     // degrees up, degrees south of east
    sunDir.set(-Math.cos(az * DEG2RAD) * Math.cos(el * DEG2RAD), Math.sin(el * DEG2RAD), -Math.sin(az * DEG2RAD) * Math.cos(el * DEG2RAD));   // -x east, -z south
    const risen = ramp(el, 0, 0.7);                                            // how much of the disc is over the ridge
    const day = ramp(el, 0, 6), dawn = ramp(el, -0.3, 8);
    const power = risen * lerp(3, 11, ramp(el, 0.3, 6));

    blend(sun.color, [1, 0.10, 0.01], [1, 0.26, 0.05], day);                   // deep red, easing to orange
    sun.intensity = power;
    sun.position.copy(sunDir).multiplyScalar(14).add(sun.target.position);
    sun.updateMatrix();
    sun.updateMatrixWorld(true);
    skyFill.intensity = lerp(0.03, 0.1, dawn);
    for (const [light, full] of bounces) light.intensity = full * power / 11;
    scene.environmentIntensity = lerp(0.06, 0.3, dawn);

    blend(sky.uZenith.value, [0.004, 0.008, 0.03], [0.02, 0.04, 0.14], dawn);
    blend(sky.uHorizon.value, [0.09, 0.03, 0.03], [0.5, 0.23, 0.11], dawn);
    blend(sky.uGlow.value, [0.45, 0.07, 0.01], [1.2, 0.5, 0.18], dawn);
    blend(sky.uLand.value, [0.05, 0.05, 0.07], [0.42, 0.36, 0.3], dawn);
    blend(sky.uCloud.value, [0.07, 0.045, 0.06], [0.85, 0.6, 0.5], dawn);
    sky.uDisc.value = 30;
    ground.material.color.copy(landBase).multiply(sky.uLand.value);
    for (const [m, tint] of townMats) m.emissive.copy(tint).multiply(sky.uHorizon.value).multiplyScalar(0.9);

    blend(volumetric.color, [1, 0.2, 0.04], [1, 0.46, 0.17], day).multiplyScalar(power / 11);
    return { exposure: lerp(1.4, 1.0, ramp(el, 0, 4)), progress: ramp(minutes, SUNRISE.start, 35) };
  }
  // seconds of breeze so far, and how hard it is blowing (0..1); returns the current swell for the sound of it
  function setWind(seconds, strength) {
    wind.uTime.value = sky.uTime.value = seconds;                              // the clouds drift on the same clock
    wind.uWind.value = strength;
    return 0.55 + 0.45 * Math.sin(seconds * 0.6) * Math.sin(seconds * 0.23 + 1.3);
  }

  setSun(SUNRISE.start);
  renderSunDepth();

  return { hideFromAO, volumetric, setSun, setWind, renderSunDepth, lamps, setLamp };
}
