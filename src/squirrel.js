// Everly's squirrel, from her front and back drawings, in the round, soft style
// of an Animal Crossing villager: a big head, a cream face mask, glossy eyes, a
// pink dress with long sleeves and a white cross on the back, stubby legs and a tail that rises beside her.
//
// She is built facing +z with her feet on y = 0, about 0.95 m to the tips of her
// ears. Each moving part hangs from its own pivot so she can be animated later:
// parts.head (neck), parts.armL / armR (shoulders), parts.legL / legR (hips), parts.tail (its root).
import * as THREE from 'three';

const C = {
  fur: '#d6884c', furDark: '#b8693a', cream: '#fdeedb', innerEar: '#f0b49c',
  dress: '#f39dbb', trim: '#ffffff',
  eye: '#2a1c1a', nose: '#5b2f24', blush: 'rgba(244, 128, 140, 0.5)',
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A sphere's texture painted from two flat pictures: what you see looking at its
// front (+z) and at its back. Each picture covers x and y from -1 to 1 as that
// viewer sees them; it is wrapped onto the sphere the way a slide projector would.
// This keeps faces and buttons in their true shapes instead of the stretched
// shapes a plain sphere map would need.
function projected(base, front, back, W = 2048, Hh = 1024) {
  const S = 1024;
  const picture = draw => {
    if (!draw) return null;
    const c = canvas(S, S), g = c.getContext('2d');
    const P = (x, y) => [(x + 1) / 2 * S, (1 - y) / 2 * S];
    draw(g, P, S / 2);
    return g.getImageData(0, 0, S, S).data;
  };
  const F = picture(front), B = picture(back);
  const out = canvas(W, Hh), g = out.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, W, Hh);
  const img = g.getImageData(0, 0, W, Hh), d = img.data;
  for (let r = 0; r < Hh; r++) {
    const th = (r + 0.5) / Hh * Math.PI, y = Math.cos(th), s = Math.sin(th);
    for (let c = 0; c < W; c++) {
      const ph = (c + 0.5) / W * Math.PI * 2, x = -Math.cos(ph) * s, z = Math.sin(ph) * s;
      const src = z > 0 ? F : B;
      if (!src) continue;
      const px = z > 0 ? x : -x;
      const i = (Math.min(S - 1, (px + 1) / 2 * S | 0) + Math.min(S - 1, (1 - y) / 2 * S | 0) * S) * 4;
      const a = src[i + 3] / 255;
      if (!a) continue;
      const o = (r * W + c) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = d[o + k] * (1 - a) + src[i + k] * a;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(out);
}

// ---------- the pictures ----------
function ellipse(g, P, u, x, y, rx, ry, rot = 0) {
  const [cx, cy] = P(x, y);
  g.ellipse(cx, cy, rx * u, ry * u, rot, 0, Math.PI * 2);
}

function face(g, P, u) {
  // the cream mask: a lobe round each eye, dipping to a point between them, and a full muzzle and chin
  g.fillStyle = C.cream;
  g.beginPath();
  for (const s of [-1, 1]) { g.moveTo(...P(s * 0.38 + 0.42, 0.04)); ellipse(g, P, u, s * 0.38, 0.04, 0.42, 0.44); }
  g.moveTo(...P(0.64, -0.36));
  ellipse(g, P, u, 0, -0.36, 0.64, 0.56);
  g.fill();

  // rosy cheeks
  g.save();
  g.filter = `blur(${u * 0.03}px)`;
  g.fillStyle = C.blush;
  for (const s of [-1, 1]) { g.beginPath(); ellipse(g, P, u, s * 0.58, -0.2, 0.13, 0.08); g.fill(); }
  g.restore();

  // eyes: tall glossy ovals
  for (const s of [-1, 1]) {
    const ex = s * 0.34, ey = 0.02;
    g.fillStyle = C.eye;
    g.beginPath(); ellipse(g, P, u, ex, ey, 0.105, 0.14, s * 0.12); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); ellipse(g, P, u, ex - s * 0.03, ey + 0.055, 0.04, 0.045); g.fill();
    g.beginPath(); ellipse(g, P, u, ex + s * 0.035, ey - 0.06, 0.018, 0.018); g.fill();
  }

  // the nose, between and a little below the eyes, and a small happy mouth
  g.fillStyle = C.nose;
  g.beginPath(); ellipse(g, P, u, 0, -0.13, 0.07, 0.048); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); ellipse(g, P, u, -0.02, -0.115, 0.022, 0.013); g.fill();
  g.strokeStyle = C.nose;
  g.lineWidth = u * 0.022;
  g.beginPath();
  g.moveTo(...P(-0.085, -0.25));
  g.quadraticCurveTo(...P(-0.04, -0.31), ...P(0, -0.25));
  g.quadraticCurveTo(...P(0.04, -0.31), ...P(0.085, -0.25));
  g.stroke();
}

// The back of the dress: a white cross, two ribbons crossing between the shoulders and the waist.
function dressBack(g, P, u) {
  g.strokeStyle = C.trim;
  g.lineWidth = u * 0.11;
  g.lineCap = 'round';
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(...P(s * 0.5, 0.78)); g.lineTo(...P(-s * 0.5, -0.2)); g.stroke(); }
}

// The tail: fur, with a cream stripe down each flat side.
function tailTexture() {
  const c = canvas(512, 256), g = c.getContext('2d');
  g.fillStyle = C.fur;
  g.fillRect(0, 0, 512, 256);
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, 'rgba(253,238,219,0)');
  grd.addColorStop(0.18, 'rgba(253,238,219,1)');
  grd.addColorStop(1, 'rgba(253,238,219,1)');
  g.fillStyle = grd;
  for (const v of [0.25, 0.75]) g.fillRect(0, (v - 0.09) * 256, 512, 0.18 * 256);
  return toTexture(c);
}

// ---------- the model ----------
export function createSquirrel() {
  const soft = (color, map) => new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : color, ...(map && { map }), roughness: 0.78,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xfff2e6).multiplyScalar(0.5),
  });
  const fur = soft(C.fur), cream = soft(C.cream), innerEar = soft(C.innerEar), dress = soft(C.dress), trim = soft(C.trim);

  const g = new THREE.Group();
  g.name = 'squirrel';
  const mesh = (geo, material, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (parent, x, y, z) => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    parent.add(p);
    return p;
  };
  const ball = (r, w = 48, h = 32) => new THREE.SphereGeometry(r, w, h);

  // body: the dress's bodice, plain pink with the cross painted on its back
  const torso = mesh(ball(1, 64, 40), soft(null, projected(C.dress, null, dressBack, 1024, 512)), g, 0, 0.34, 0);
  torso.scale.set(0.15, 0.165, 0.13);

  // the skirt, scalloped at the hem, with a white frill peeping out beneath.
  // (Lathe outlines run from the bottom up, so the cloth's front faces point outwards:
  // the ambient-occlusion pass only sees front faces, and inward ones let the legs show through.)
  const scallop = (geo, amount, from) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amount * Math.sin(14 * Math.atan2(z, x)) * THREE.MathUtils.smoothstep(from - y, 0, 0.08);
      p.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const skirtShape = [[0.222, 0.07], [0.216, 0.09], [0.205, 0.14], [0.19, 0.19], [0.17, 0.24], [0.152, 0.28], [0.143, 0.31]].map(([r, y]) => new THREE.Vector2(r, y));
  const skirt = mesh(scallop(new THREE.LatheGeometry(skirtShape, 96), 0.025, 0.14), dress, g);
  skirt.scale.z = 0.88;
  skirt.material = dress.clone();
  skirt.material.side = THREE.DoubleSide;
  const frillShape = [[0.232, 0.046], [0.228, 0.052], [0.212, 0.075], [0.19, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  const frill = mesh(scallop(new THREE.LatheGeometry(frillShape, 128), 0.035, 0.09), trim.clone(), g);  // the frill
  frill.material.side = THREE.DoubleSide;
  frill.scale.z = 0.88;
  // a lining across the inside of the skirt, so it reads as solid cloth from below too
  const lining = mesh(new THREE.CircleGeometry(0.2, 48), dress, g, 0, 0.1, 0);
  lining.rotation.x = Math.PI / 2;
  lining.scale.y = 0.88;

  // legs: short and round, hanging from the hips under the long skirt, with only the toes peeping out
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(g, s * 0.075, 0.17, 0);
    mesh(new THREE.CapsuleGeometry(0.052, 0.07, 8, 24), fur, hip, 0, -0.08, 0.05).rotation.x = 0.6;
    const foot = mesh(ball(1, 32, 20), fur, hip, 0, -0.135, 0.12);
    foot.scale.set(0.062, 0.042, 0.078);
    legs.push(hip);
  }

  // arms: a long pink sleeve down to the wrist, then a soft arm and a round hand, hanging a little away from the skirt
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = pivot(g, s * 0.135, 0.44, 0);
    shoulder.rotation.z = s * 0.42;
    mesh(new THREE.CylinderGeometry(0.05, 0.054, 0.165, 32), dress, shoulder, 0, -0.07, 0);
    mesh(new THREE.CapsuleGeometry(0.04, 0.09, 8, 20), fur, shoulder, 0, -0.11, 0);
    mesh(ball(0.05, 32, 20), fur, shoulder, 0, -0.185, 0.005);
    arms.push(shoulder);
  }

  // head: a big round head with the face painted on, and round ears with cream insides
  const head = pivot(g, 0, 0.47, 0);
  const skull = mesh(ball(1, 96, 64), soft(null, projected(C.fur, face, null)), head, 0, 0.2, 0.01);
  skull.scale.set(0.25, 0.215, 0.22);
  for (const s of [-1, 1]) {
    const ear = pivot(head, s * 0.165, 0.39, -0.03);
    ear.rotation.z = -s * 0.4;
    mesh(ball(1, 32, 20), fur, ear).scale.set(0.068, 0.07, 0.035);
    mesh(ball(1, 32, 20), innerEar, ear, 0, 0.002, 0.022).scale.set(0.04, 0.043, 0.015);
  }

  // tail: rising beside her (on her left, as in the drawings), facing front and back. The curve is drawn flat (out, up) and the whole
  // tail is then turned so it reads from the front, the back and the side.
  const tail = pivot(g, 0.05, 0.22, -0.1);
  tail.rotation.y = 0.65;
  {
    // out from her back, then up beside her, the tip tipping over outwards in a little curl
    const pts = [[0, 0], [0.1, 0.0], [0.2, 0.05], [0.27, 0.14], [0.3, 0.26], [0.31, 0.38], [0.34, 0.48], [0.4, 0.55], [0.47, 0.575], [0.525, 0.55], [0.54, 0.505]];
    const curve = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, 'centripetal');
    const TS = 220, RS = 40, R = 0.1;
    const geo = new THREE.TubeGeometry(curve, TS, R, RS, false);
    const radius = t => {
      const body = 0.045 + 0.068 * Math.sin(Math.PI * Math.min(1, Math.pow(t / 0.92, 0.75)));   // swells, then tapers to the tip
      const tufts = 1 + 0.02 * Math.sin(t * 34);                                                // soft scallops of fur
      return Math.max(0.026, body) * tufts;
    };
    const p = geo.attributes.position, P = new THREE.Vector3(), V = new THREE.Vector3();
    for (let i = 0; i <= TS; i++) {
      curve.getPointAt(i / TS, P);
      const k = radius(i / TS) / R;
      for (let j = 0; j <= RS; j++) {
        const n = i * (RS + 1) + j;
        V.fromBufferAttribute(p, n).sub(P).multiplyScalar(k).add(P);
        p.setXYZ(n, V.x, V.y, V.z);
      }
    }
    geo.computeVertexNormals();
    const tailMat = soft(null, tailTexture());
    mesh(geo, tailMat, tail);
    const tip = curve.getPointAt(1);
    mesh(ball(radius(1), 24, 16), tailMat, tail, tip.x, tip.y, tip.z);
  }

  return { group: g, parts: { head, armL: arms[1], armR: arms[0], legL: legs[1], legR: legs[0], tail } };
}
