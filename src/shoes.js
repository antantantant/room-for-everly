import * as THREE from 'three';

// Shoes by the back door, on a doormat just outside it: pink sneakers and yellow rain
// boots. Standing by a pair, B puts them on: they leave the mat and appear on her feet,
// and walk with her. B again takes them off, and they are back on the mat.

const STYLES = {
  sneakers: { title: 'sneakers', upper: 0xf48fb1, sole: 0xffffff, trim: 0xffffff },
  boots: { title: 'rain boots', upper: 0xffd23f, sole: 0x9a6a4a, trim: 0xfff4c2 },
};

// One shoe, built round her foot: its origin is the middle of the sole, toes towards +z.
// (Her foot is an ellipsoid 0.124 wide, 0.084 tall and 0.156 long.)
function makeShoe(style) {
  const s = STYLES[style], g = new THREE.Group();
  const m = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const part = (geo, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const o = new THREE.Mesh(geo, m(color));
    o.position.set(x, y, z); o.scale.set(sx, sy, sz);
    o.castShadow = o.receiveShadow = true;
    g.add(o);
    return o;
  };
  const ball = new THREE.SphereGeometry(1, 28, 18), disc = new THREE.CylinderGeometry(1, 1, 1, 28);
  part(disc, s.sole, 0, 0.009, 0, 0.072, 0.018, 0.09);                         // the sole
  part(ball, s.upper, 0, 0.045, 0.004, 0.069, 0.05, 0.088);                    // the upper, over her foot
  if (style === 'sneakers') {
    part(ball, s.trim, 0, 0.03, 0.055, 0.05, 0.03, 0.04);                       // a white toe cap
    for (const k of [-1, 1]) part(ball, s.trim, k * 0.018, 0.09, 0.0, 0.016, 0.011, 0.01).rotation.z = k * 0.5;   // a bow
    part(ball, s.trim, 0, 0.09, 0, 0.008, 0.008, 0.008);
  } else {
    // a shaft up her shin (her legs lean forward a little, so it does too), with a pale rim
    const shaft = part(new THREE.CylinderGeometry(0.056, 0.06, 0.1, 24, 1, true), s.upper, 0, 0.1, -0.035);
    shaft.rotation.x = 0.35; shaft.material.side = THREE.DoubleSide;
    const rim = part(new THREE.TorusGeometry(0.056, 0.008, 8, 24), s.trim, 0, 0.148, -0.018);
    rim.rotation.x = Math.PI / 2 + 0.35;
    for (const [x, z] of [[0.04, 0.05], [-0.035, 0.03], [0.0, 0.075]]) part(ball, 0xffffff, x, 0.06, z, 0.008, 0.008, 0.008);   // dots
  }
  return g;
}

export function createShoes({ scene, camera, room, squirrel, walker, isBusy, hint }) {
  const W = (x, z) => new THREE.Vector3(x - room.plan.x, 0, z - room.plan.z);

  // the doormat, just outside the back door to its east, and the two pairs on it
  const mat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.38), new THREE.MeshStandardMaterial({ color: 0xd9b07a, roughness: 1 }));
  mat.position.copy(W(7.85, -0.3)).setY(0.006);
  mat.receiveShadow = true;
  const border = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.01, 0.42), new THREE.MeshStandardMaterial({ color: 0xf2a9be, roughness: 1 }));
  border.position.copy(mat.position).setY(0.004);
  scene.add(border, mat);

  const pairs = [['sneakers', 7.7], ['boots', 8.0]].map(([style, x]) => {
    const obj = new THREE.Group();
    obj.position.copy(W(x, -0.3)).setY(0.012);
    obj.rotation.y = Math.PI;                                                   // toes to the yard
    for (const k of [-1, 1]) { const sh = makeShoe(style); sh.position.x = k * 0.075; sh.rotation.y = -k * 0.08; obj.add(sh); }
    scene.add(obj);
    return { style, obj };
  });

  walker.refresh();                                                           // so she walks round them

  // on her feet: a shoe on each hip, where her foot is
  const onFeet = new Map();
  function feetFor(style) {
    if (!onFeet.has(style)) {
      const list = [squirrel.parts.legL, squirrel.parts.legR].map(hip => {
        const sh = makeShoe(style);
        sh.position.set(0, -0.135 - 0.042 - 0.004, 0.12);                        // her foot's centre, down to its sole
        sh.visible = false;
        hip.add(sh);
        return sh;
      });
      onFeet.set(style, list);
    }
    return onFeet.get(style);
  }

  let worn = null;
  function wear(pair) {
    if (worn) { worn.obj.visible = true; feetFor(worn.style).forEach(s => { s.visible = false; }); }
    worn = pair;
    if (pair) { pair.obj.visible = false; feetFor(pair.style).forEach(s => { s.visible = true; }); }
    walker.refresh();
  }

  const near = () => {
    const p = squirrel.group.position;
    let best = null, bd = 0.6;
    for (const pair of pairs) {
      const d = Math.hypot(pair.obj.position.x - p.x, pair.obj.position.z - p.z);
      if (pair !== worn && d < bd) { bd = d; best = pair; }
    }
    return best;
  };
  const byMat = () => { const p = squirrel.group.position; return Math.hypot(mat.position.x - p.x, mat.position.z - p.z) < 0.75; };

  addEventListener('keydown', e => {
    if (e.code !== 'KeyB' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isBusy()) return;
    const pair = near();
    if (pair) wear(pair);            // put these on (swapping, if she had the others on)
    else if (worn) wear(null);       // take them off: back on the mat
  });

  const at = new THREE.Vector3();
  function update() {
    const pair = isBusy() ? null : near();
    let text = null, where = null;
    if (pair) { text = `B · put on the ${STYLES[pair.style].title}`; where = pair.obj.position; }
    else if (worn && byMat() && !isBusy()) { text = `B · take off the ${STYLES[worn.style].title}`; where = mat.position; }
    if (!text) { hint.hidden = true; return; }
    at.copy(where).setY(0.32).project(camera);
    if (at.z > 1) { hint.hidden = true; return; }
    hint.hidden = false;
    hint.textContent = text;
    hint.style.left = `${THREE.MathUtils.clamp((at.x * 0.5 + 0.5) * innerWidth, 120, innerWidth - 120)}px`;
    hint.style.top = `${THREE.MathUtils.clamp((-at.y * 0.5 + 0.5) * innerHeight, 150, innerHeight - 60)}px`;
  }

  return { update, get worn() { return worn && worn.style; }, wear: style => wear(pairs.find(p => p.style === style) || null) };
}
