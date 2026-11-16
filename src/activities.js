// Things the squirrel can do with the furniture: sleep in the bunk bed, bounce on
// the sofa, brush her teeth, water the plants...
//
// When she is next to something with things to do, a "P" pops up over it; R makes
// her do one of them, chosen at random. Each activity is a little script (a
// generator: it runs a step each frame) that walks her into place, poses her,
// shows props and sparkles, then brings her back to where she started. Any walking
// key stops it early.
//
// Activities cost energy (bouncing and dancing most); sleeping fills it up again
// and snacks help. Too tired, she will not play until she has had a nap, and doing
// the same thing three times running bores her.
import * as THREE from 'three';

const PI = Math.PI;
const lerp = THREE.MathUtils.lerp;
const ease = k => k * k * (3 - 2 * k);
const pick = list => list[Math.floor(Math.random() * list.length)];
const SPREAD = 0.42;                        // how far her arms hang out from her sides at rest
const DRESSES = ['#b9a6ef', '#8fd3c4', '#f7d76e', '#8ec5f2', '#f49a8f', '#ffffff'];

export function createActivities({ room, squirrel, walker, feelings, scene, pipeline, interaction, camera, bubble, caption }) {
  const { group, parts } = squirrel;
  const W = (x, y, z) => new THREE.Vector3(x - room.plan.x, y, z - room.plan.z);   // plan metres to world
  const named = name => room.interactables.filter(i => i.name === name);

  // ---------- her pose while an activity has her ----------
  // h: which way she faces (0 = +z); pitch tips her over (-PI/2 lies on her back);
  // arms: x swings forward (negative) and s spreads outwards.
  const A = { x: 0, y: 0, z: 0, h: 0, pitch: 0, roll: 0, legL: 0, legR: 0, aLx: 0, aLs: SPREAD, aRx: 0, aRs: SPREAD, headX: 0, headZ: 0 };
  function applyPose() {
    group.position.set(A.x, A.y, A.z);
    group.rotation.set(A.pitch, A.h, A.roll);
    parts.legL.rotation.x = A.legL; parts.legR.rotation.x = A.legR;
    parts.armL.rotation.set(A.aLx, 0, A.aLs);
    parts.armR.rotation.set(A.aRx, 0, -A.aRs);
    parts.head.rotation.set(A.headX, 0, A.headZ);
  }
  const limbsRest = () => Object.assign(A, { legL: 0, legR: 0, aLx: 0, aLs: SPREAD, aRx: 0, aRs: SPREAD, headX: 0, headZ: 0, roll: 0 });

  // ---------- little scripts ----------
  // wait(seconds, each): each(k from 0 to 1, t seconds, dt) every frame
  function* wait(sec, each) { let t = 0; while (t < sec) { const dt = yield; t = Math.min(sec, t + dt); each?.(t / sec, t, dt); } }
  function* blend(to, sec = 0.35, each) {
    const from = {}; for (const k in to) from[k] = A[k];
    yield* wait(sec, (k, t, dt) => { const e = ease(k); for (const key in to) A[key] = from[key] + (to[key] - from[key]) * e; each?.(k, t, dt); });
  }
  function* turn(h, sec = 0.25) {
    const h0 = A.h, d = Math.atan2(Math.sin(h - h0), Math.cos(h - h0));
    if (Math.abs(d) > 0.01) yield* wait(sec, k => { A.h = h0 + d * ease(k); });
  }
  const faceTo = (x, z) => turn(Math.atan2(x - A.x, z - A.z));
  // walk to (x, z) at the height she is at (the floor, or the top bunk), with her walk cycle
  function* walk(x, z, h) {
    const x0 = A.x, z0 = A.z, y0 = A.y, d = Math.hypot(x - x0, z - z0);
    if (d > 0.03) {
      yield* turn(Math.atan2(x - x0, z - z0), 0.2);
      yield* wait(d / 0.9, k => {
        A.x = lerp(x0, x, k); A.z = lerp(z0, z, k);
        const s = Math.sin(k * d * 7.2);
        A.legL = s * 0.5; A.legR = -s * 0.5; A.aLx = -s * 0.5; A.aRx = s * 0.5; A.y = y0 + Math.abs(s) * 0.02;
      });
    }
    A.legL = A.legR = A.aLx = A.aRx = 0; A.y = y0;
    if (h !== undefined) yield* turn(h);
  }
  // a hop from where she is to (x, y, z): onto a bed, down from a stool
  function* hop(x, y, z, legs = 0) {
    const s = { x: A.x, y: A.y, z: A.z, legL: A.legL }, top = Math.max(s.y, y) + 0.22;
    yield* wait(0.45, k => {
      A.x = lerp(s.x, x, k); A.z = lerp(s.z, z, k);
      A.y = (1 - k) * (1 - k) * s.y + 2 * (1 - k) * k * top + k * k * y;
      A.legL = A.legR = lerp(s.legL, legs, k) - 0.5 * Math.sin(PI * k);
    });
  }
  const forward = h => [Math.sin(h), Math.cos(h)];

  // sitting: on a seat whose top is at height y, facing h. She stands in front of it, turns round and hops up.
  // Once she is sitting she stays there until an arrow key is pressed; then she hops off.
  let seatFrom = null, seated = false, testing = false;
  function* sit({ x, y, z, h }) {
    const [fx, fz] = forward(h);
    seatFrom = { x: x + fx * 0.38, z: z + fz * 0.38 };
    yield* walk(seatFrom.x, seatFrom.z);
    yield* turn(h);
    yield* hop(x, y - 0.13, z, -1.35);
    A.legL = A.legR = -1.35;
    seated = true;
  }
  function* hopOff() { yield* hop(seatFrom.x, 0.01, seatFrom.z, 0); A.legL = A.legR = 0; seated = false; }
  function* stay() {                                        // sit on, calmly, until an arrow key
    if (testing) return;
    showCaption('Sitting · press an arrow key to get up');
    yield* blend({ aLx: 0, aLs: SPREAD, aRx: 0, aRs: SPREAD, headX: 0, headZ: 0, roll: 0 }, 0.4);
    yield* wait(Infinity, (k, t) => { A.legL = -1.35 + 0.12 * Math.sin(t * 1.8); A.legR = -1.35 - 0.12 * Math.sin(t * 1.8); A.headZ = Math.sin(t * 0.5) * 0.05; });
  }
  function* unsit() { yield* stay(); yield* hopOff(); }
  const swingLegs = t => { A.legL = -1.35 + 0.3 * Math.sin(t * 5); A.legR = -1.35 - 0.3 * Math.sin(t * 5); };

  // lying down on her back: feet at (x, z) on a top at height y, head towards the back of h
  let lieFrom = null;
  function* lie({ x, y, z, h }, onTummy = false) {
    const [fx, fz] = forward(h), cx = x - fx * 0.45, cz = z - fz * 0.45;
    if (y > 0.15) {                                         // up onto a bed or sofa from the side nearer her
      const side = (A.x - cx) * fz - (A.z - cz) * fx > 0 ? 1 : -1;
      lieFrom = { x: cx + fz * side * 0.75, z: cz - fx * side * 0.75 };
      yield* walk(lieFrom.x, lieFrom.z);
      yield* faceTo(cx, cz);
      yield* hop(cx, y, cz);
    } else { lieFrom = null; yield* walk(cx, cz); }
    yield* turn(h);
    yield* blend({ pitch: onTummy ? PI / 2 : -PI / 2, y: y + 0.17, x: onTummy ? cx + fx * 0.45 : x, z: onTummy ? cz + fz * 0.45 : z, aLx: -0.3, aRx: -0.3 }, 0.6);
    lieAt = { cx, cz, y };
  }
  let lieAt = null;
  function* getUp() {
    yield* blend({ pitch: 0, roll: 0, y: lieAt.y, x: lieAt.cx, z: lieAt.cz, legL: 0, legR: 0, aLx: 0, aRx: 0 }, 0.5);
    if (lieFrom) yield* hop(lieFrom.x, 0.01, lieFrom.z);
  }
  function* bounce(sec, base) {
    yield* wait(sec, (k, t) => {
      const b = Math.abs(Math.sin(t * PI * 1.7));
      A.y = base + b * 0.3; A.legL = A.legR = -0.5 * (1 - b); A.aLx = A.aRx = -1.6 - b; A.aLs = A.aRs = 0.6;
    });
    limbsRest(); A.y = base;
  }
  function* dance(sec, notes = true) {
    const h0 = A.h, y0 = A.y;
    yield* wait(sec, (k, t, dt) => {
      A.h = h0 + Math.sin(t * 1.6) * 1.2;
      A.y = y0 + Math.abs(Math.sin(t * 4)) * 0.06; A.roll = Math.sin(t * 4) * 0.15;
      A.aLx = -2.5 + Math.sin(t * 4) * 0.5; A.aRx = -2.5 - Math.sin(t * 4) * 0.5; A.aLs = A.aRs = 0.5;
      A.legL = Math.max(0, Math.sin(t * 4)) * -0.4; A.legR = Math.max(0, -Math.sin(t * 4)) * -0.4;
      if (notes) emitEvery(dt, 2.5, 'note', mouth(), { v: [0, 0.35, 0], vr: 0.15, life: 1.4, size: 0.07 });
    });
    limbsRest(); A.h = h0; A.y = y0;
  }
  // stand on a little stool (the counters are taller than she is)
  let stoolProp = null;
  function* stool(x, z, h) {                               // (x, z) in plan metres
    const v = W(x, 0, z);
    yield* walk(v.x - Math.sin(h) * 0.25, v.z - Math.cos(h) * 0.25, h);
    stoolProp = place(prop('stool'), v);
    yield* hop(v.x, 0.3, v.z);
  }
  function* offStool() { const [fx, fz] = forward(A.h); yield* hop(A.x - fx * 0.32, 0.01, A.z - fz * 0.32); stoolProp?.removeFromParent(); stoolProp = null; }
  const walkPlan = (x, z, h) => { const v = W(x, 0, z); return walk(v.x, v.z, h); };

  // ---------- gestures, for use inside wait() ----------
  const toMouth = (t, wobble = 0) => { A.aRx = -2.15; A.aRs = -0.3 + wobble * Math.sin(t * 25); };
  const munch = t => { const up = Math.sin(t * 3) > 0; A.aRx = up ? -2.15 : -1.2; A.aRs = up ? -0.3 : 0; A.headX = up ? 0.05 : 0; };
  const wave = t => { A.aRx = -2.9; A.aRs = 0.3 + 0.35 * Math.sin(t * 9); };
  const knock = t => { A.aRx = -1.6 + 0.3 * Math.max(0, Math.sin(t * 11)); A.aRs = -0.1; };
  const stir = t => { A.aRx = -1.3 + 0.15 * Math.cos(t * 6); A.aRs = 0.05 + 0.18 * Math.sin(t * 6); };
  const handsForward = (t, wob = 0) => { A.aLx = -1.25 + wob * Math.sin(t * 14); A.aRx = -1.25 - wob * Math.sin(t * 14); A.aLs = A.aRs = -0.05; };
  const scribble = (t, fast = 1) => { A.aRx = -1.15 + 0.08 * Math.sin(t * 13 * fast); A.aRs = -0.05 + 0.12 * Math.sin(t * 7 * fast); A.headX = 0.3; };

  // ---------- props and sparkles ----------
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const mk = (geo, c, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); m.castShadow = true; return m; };
  const bundle = (...ms) => { const g = new THREE.Group(); g.add(...ms); return g; };
  const doodle = (() => {                                  // the picture she holds up
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#fffdf6'; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(100, 22, 13, 0, PI * 2); g.fill();
    g.strokeStyle = '#7fc7f2'; g.lineWidth = 5; g.beginPath(); g.moveTo(8, 80); g.quadraticCurveTo(40, 60, 70, 80); g.quadraticCurveTo(95, 95, 122, 76); g.stroke();
    g.fillStyle = '#f472a0'; g.beginPath(); g.moveTo(44, 62); g.bezierCurveTo(20, 44, 30, 22, 44, 36); g.bezierCurveTo(58, 22, 68, 44, 44, 62); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  function prop(kind) {
    switch (kind) {
      case 'cup': return bundle(mk(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 16), 0xf7a8c4, 0, 0.03, 0));
      case 'strawberry': return bundle(mk(new THREE.SphereGeometry(0.024, 12, 10), 0xe0324d), mk(new THREE.ConeGeometry(0.016, 0.012, 6), 0x5ca35c, 0, 0.024, 0));
      case 'cupcake': return bundle(mk(new THREE.CylinderGeometry(0.032, 0.024, 0.04, 16), 0xf7a8c4, 0, 0.02, 0), mk(new THREE.SphereGeometry(0.035, 14, 10), 0xfffafa, 0, 0.05, 0), mk(new THREE.SphereGeometry(0.011, 8, 6), 0xe0324d, 0, 0.085, 0));
      case 'yogurt': return bundle(mk(new THREE.CylinderGeometry(0.035, 0.028, 0.07, 16), 0xffffff, 0, 0.035, 0), mk(new THREE.CylinderGeometry(0.036, 0.036, 0.005, 16), 0xd9c8f0, 0, 0.072, 0));
      case 'milk': return bundle(mk(new THREE.BoxGeometry(0.06, 0.13, 0.06), 0xffffff, 0, 0.065, 0), mk(new THREE.ConeGeometry(0.045, 0.04, 4), 0xf7a8c4, 0, 0.15, 0));
      case 'spoon': return bundle(mk(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 8), 0xf7a8c4, 0, -0.06, 0.02));
      case 'toothbrush': return bundle(mk(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 8), 0xbfe6d6, 0, 0.02, 0), mk(new THREE.BoxGeometry(0.014, 0.025, 0.018), 0xffffff, 0, 0.09, 0.008));
      case 'crayon': return bundle(mk(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 8), pick([0xf47aa0, 0x7fc7f2, 0xffd34d, 0x9ad87a]), 0, -0.02, 0.02));
      case 'fork': return bundle(mk(new THREE.BoxGeometry(0.012, 0.16, 0.005), 0xdfe3e8, 0, 0.04, 0));
      case 'plate': return bundle(mk(new THREE.CylinderGeometry(0.1, 0.08, 0.012, 24), 0xffffff));
      case 'can': return bundle(mk(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 16), 0x8fd3c4, 0, 0, 0.08), mk(new THREE.CylinderGeometry(0.008, 0.012, 0.13, 8), 0x8fd3c4, 0, 0.03, 0.18).rotateX(1.0));
      case 'paper': { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), new THREE.MeshStandardMaterial({ map: doodle, side: THREE.DoubleSide, roughness: 0.9 })); return bundle(m); }
      case 'block': return bundle(mk(new THREE.BoxGeometry(0.07, 0.07, 0.07), pick([0xfbd3df, 0xbfe6d6, 0xfbe7a6, 0xc6e2f5]), 0, 0.035, 0));
      case 'ball': return bundle(mk(new THREE.SphereGeometry(0.06, 20, 14), 0xf48fb1, 0, 0.06, 0));
      case 'stool': return bundle(mk(new THREE.CylinderGeometry(0.17, 0.19, 0.28, 24), 0xf7b6c8, 0, 0.14, 0), mk(new THREE.CylinderGeometry(0.175, 0.175, 0.02, 24), 0xffffff, 0, 0.29, 0));
    }
  }
  let cleanups = [];
  const place = (obj, at) => { obj.position.copy(at); scene.add(obj); cleanups.push(() => obj.removeFromParent()); return obj; };
  const inHand = (obj, side = 'R') => { obj.position.set(0, -0.21, 0.04); (side === 'R' ? parts.armR : parts.armL).add(obj); cleanups.push(() => obj.removeFromParent()); return obj; };
  const mouth = () => parts.head.localToWorld(new THREE.Vector3(0, 0.15, 0.24));
  const handAt = (side = 'R') => (side === 'R' ? parts.armR : parts.armL).localToWorld(new THREE.Vector3(0, -0.21, 0.04));

  // sparkles, drops, steam, bubbles, hearts and notes: little sprites that drift and fade
  const fx = new THREE.Group();
  scene.add(fx);
  pipeline.hideFromAO.push(fx);
  const spriteTex = draw => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const TEX = {
    drop: spriteTex(g => { g.fillStyle = '#7fc4f5'; g.beginPath(); g.arc(32, 36, 18, 0, PI * 2); g.fill(); g.fillStyle = '#e6f6ff'; g.beginPath(); g.arc(26, 30, 5, 0, PI * 2); g.fill(); }),
    puff: spriteTex(g => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }),
    bubble: spriteTex(g => { g.strokeStyle = 'rgba(200,235,255,0.95)'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 24, 0, PI * 2); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(24, 22, 5, 0, PI * 2); g.fill(); }),
    spark: spriteTex(g => { g.fillStyle = '#ffe27a'; g.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 7 : 28, a = i / 8 * PI * 2; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill(); }),
    heart: spriteTex(g => { g.fillStyle = '#f472a0'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 32, 14, 6, 32, 22); g.bezierCurveTo(50, 6, 60, 32, 32, 54); g.fill(); }),
    note: spriteTex(g => { g.fillStyle = '#9b7fe0'; g.font = 'bold 52px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 32, 34); }),
    z: spriteTex(g => { g.fillStyle = '#8a7fd6'; g.font = 'bold 50px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', 32, 34); }),
  };
  const sparks = [];
  function emit(kind, at, { n = 1, spread = 0.03, v = [0, 0.3, 0], vr = 0.05, grav = 0, life = 1, size = 0.05, grow = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[kind], transparent: true, depthWrite: false }));
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2));
      s.scale.setScalar(size);
      fx.add(s);
      sparks.push({ s, v: new THREE.Vector3(v[0] + (Math.random() - 0.5) * vr * 2, v[1] + (Math.random() - 0.5) * vr * 2, v[2] + (Math.random() - 0.5) * vr * 2), grav, life, age: 0, size, grow });
    }
  }
  const owed = new Map();                                  // emit about `rate` a second
  function emitEvery(dt, rate, kind, at, opts) {
    const key = kind + rate, due = (owed.get(key) || 0) + dt * rate, n = Math.floor(due);
    owed.set(key, due - n);
    if (n) emit(kind, at, { ...opts, n });
  }
  function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.age += dt;
      p.v.y -= p.grav * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size * (1 + p.grow * p.age));
      p.s.material.opacity = Math.min(1, (1 - p.age / p.life) * 2);
      if (p.age >= p.life) { p.s.removeFromParent(); p.s.material.dispose(); sparks.splice(i, 1); }
    }
  }

  // borrow something from the room for a while (a plush to hug, the backpack); it goes back exactly where it was
  function borrow(obj, into, at, rot = new THREE.Euler()) {
    const home = { parent: obj.parent, p: obj.position.clone(), q: obj.quaternion.clone() };
    into.add(obj); obj.position.copy(at); obj.quaternion.setFromEuler(rot);
    cleanups.push(() => { home.parent.add(obj); obj.position.copy(home.p); obj.quaternion.copy(home.q); });
  }
  const sw = (name, near) => {                            // the nearest switchable thing called `name`
    let best = null, bd = Infinity;
    for (const it of named(name)) { const p = it.obj.getWorldPosition(new THREE.Vector3()); const d = near ? p.distanceTo(near) : 0; if (d < bd) { bd = d; best = it; } }
    return best;
  };
  const chairNear = (x, z, r = 0.6) => {                  // a chair still standing near a spot (plan metres)
    const at = W(x, 0, z);
    return named('chair').find(c => !isCarried(c.obj) && c.obj.getWorldPosition(new THREE.Vector3()).setY(0).distanceTo(at) < r);
  };
  const chairSeat = c => {
    const p = c.obj.getWorldPosition(new THREE.Vector3()), q = c.obj.getWorldQuaternion(new THREE.Quaternion());
    const h = new THREE.Euler().setFromQuaternion(q, 'YXZ').y, sc = c.obj.getWorldScale(new THREE.Vector3()).y;
    return { x: p.x, y: p.y + 0.505 * sc, z: p.z, h };
  };
  const isCarried = obj => { for (let o = obj; o; o = o.parent) if (o === group) return true; return false; };
  const lampNamed = name => room.lamps.find(l => l.switch && l.switch.name === name);

  // ---------- what there is to do ----------
  // Each activity: a title for the caption, its energy cost (negative restores),
  // the feeling it brings, and its script. `spot` is what she is next to.
  const ACT = {
    // the bunk bed
    bunkSleepLow: { title: 'Sleep on the lower bunk', cost: -1, mood: 'sleepy', *run() { yield* lie(wp(8.84, 0.52, 11.55, 0)); yield* sleep(6); yield* getUp(); } },
    bunkSitLow: { title: 'Sit on the lower bunk', cost: 0.02, *run() { yield* sit(wp(8.42, 0.52, 11.2, -PI / 2)); yield* wait(4, swingLegs); yield* unsit(); } },
    bunkClimbSleep: { title: 'Climb up and sleep on the top bunk', cost: -0.9, mood: 'sleepy', *run() { yield* climb(); yield* lie(wp(8.84, 1.56, 11.5, 0)); yield* sleep(6); yield* getUp(); yield* climbDown(); } },
    bunkClimbJump: { title: 'Climb up and jump on the top bunk!', cost: 0.18, mood: 'happy', *run() { yield* climb(); const v = W(8.84, 1.56, 11.3); yield* hop(v.x, 1.56, v.z); yield* bounce(4, 1.56); const t = W(8.55, 1.56, 11.92); yield* hop(t.x, 1.56, t.z); yield* climbDown(); } },
    // the main bed
    bedSleep: { title: 'Sleep in the big bed', cost: -1, mood: 'sleepy', *run() { yield* lie(wp(1.45, 0.62, 7.7, PI / 2)); yield* sleep(6); yield* getUp(); } },
    bedSit: { title: 'Sit on the edge of the bed', cost: 0.02, *run() { yield* sit(wp(1.3, 0.62, 8.42, 0)); yield* wait(4, swingLegs); yield* unsit(); } },
    bedBounce: { title: 'Bounce on the bed!', cost: 0.16, mood: 'happy', *run() { yield* onTop(1.25, 0.62, 7.7); yield* bounce(4, 0.62); yield* offTop(); } },
    bedHug: { title: 'Hug Melody', cost: 0.02, mood: 'happy', ok: () => plushNear(W(0.75, 0.6, 7.7), 0.8), *run() { const p = plushNear(W(0.75, 0.6, 7.7), 0.8); yield* sit(wp(1.0, 0.62, 8.42, 0)); yield* hug(p, 3.5, true); yield* unsit(); } },
    // sofa and loveseat
    sofaSit: { title: 'Sit on the sofa', cost: 0.01, *run() { yield* sit(wp(2.7 + (Math.random() - 0.5) * 0.8, 0.44, 0.6, 0)); yield* wait(4, t => { swingLegs(t * 0.6); A.headZ = Math.sin(t) * 0.08; }); yield* unsit(); } },
    sofaNap: { title: 'A nap on the sofa', cost: -0.6, mood: 'sleepy', *run() { yield* lie(wp(3.15, 0.46, 0.62, PI / 2)); yield* sleep(5); yield* getUp(); } },
    sofaBounce: { title: 'Bounce on the cushions!', cost: 0.16, mood: 'happy', *run() { yield* onTop(2.7, 0.44, 0.62); yield* bounce(4, 0.44); yield* offTop(); } },
    loveSit: { title: 'Sit on the little sofa', cost: 0.01, *run() { yield* sit(wp(0.62, 0.44, 2.0, PI / 2)); yield* wait(4, swingLegs); yield* unsit(); } },
    loveWindow: { title: 'Look out at the castle', cost: 0.01, *run() { yield* onTop(0.5, 0.44, 2.0); yield* turn(-PI / 2); yield* wait(2.5, () => { A.headX = -0.15; A.aLx = A.aRx = -1.3; }); yield* wait(1.5, t => wave(t)); limbsRest(); yield* offTop(); } },
    loveNap: { title: 'Curl up for a nap', cost: -0.6, mood: 'sleepy', *run() { yield* lie(wp(0.6, 0.46, 2.45, 0)); yield* sleep(5); yield* getUp(); } },
    // coffee table and TV
    sip: { title: 'A sip of tea', cost: -0.05, mood: 'happy', *run(spot) { yield* faceSpot(spot); inHand(prop('cup')); yield* wait(3.5, (k, t) => { const up = Math.sin(t * 2.5) > 0.2; A.aRx = up ? -2.1 : -1.0; A.aRs = up ? -0.3 : 0.1; }); } },
    strawberry: { title: 'Eat a strawberry', cost: -0.08, mood: 'happy', *run(spot) { yield* faceSpot(spot); const s = inHand(prop('strawberry')); yield* wait(3, (k, t) => { munch(t); s.scale.setScalar(1 - k * 0.8); }); emit('heart', mouth(), { n: 2, v: [0, 0.4, 0], life: 1.2, size: 0.06 }); } },
    tvWatch: { title: 'Watch TV', cost: 0.02, *run() { tvOn(); yield* walkPlan(2.45, 2.85, 0); yield* blend({ y: -0.11, legL: -1.4, legR: -1.4 }, 0.4); yield* wait(7, t => { A.headZ = Math.sin(t * 0.7) * 0.1; A.aLx = A.aRx = -0.5; }); yield* blend({ y: 0.01, legL: 0, legR: 0, aLx: 0, aRx: 0 }, 0.35); } },
    tvDance: { title: 'Dance to the TV!', cost: 0.15, mood: 'happy', *run() { tvOn(); yield* walkPlan(2.45, 2.85, 0); yield* dance(5); } },
    stack: { title: 'Stack the blocks', cost: 0.03, mood: 'happy', *run() { yield* stackBlocks(); } },
    rollBall: { title: 'Roll the ball', cost: 0.06, mood: 'happy', *run() { yield* rollBall(); } },
    // rugs
    rugDance: { title: 'Dance!', cost: 0.15, mood: 'happy', *run() { yield* dance(5); } },
    rugRoll: { title: 'Roll around!', cost: 0.12, mood: 'happy', *run() { yield* floorLie(false); yield* wait(4, t => { A.roll = Math.sin(t * 4) * 0.5; A.legL = -0.6 + Math.sin(t * 8) * 0.4; A.legR = -0.6 - Math.sin(t * 8) * 0.4; }); yield* getUp(); } },
    rugTummy: { title: 'Lie on her tummy', cost: 0.01, *run() { yield* floorLie(true); yield* wait(4, t => { A.legL = 0.6 + Math.sin(t * 4) * 0.4; A.legR = 0.6 - Math.sin(t * 4) * 0.4; A.headX = -0.4; }); yield* getUp(); } },
    rugCeiling: { title: 'Look at the ceiling', cost: -0.1, *run() { yield* floorLie(false); yield* wait(5, t => { A.aLx = A.aRx = -2.8; A.aLs = A.aRs = 0.9 + Math.sin(t) * 0.1; }); yield* getUp(); } },
    rugHop: { title: 'Bunny hops!', cost: 0.14, mood: 'happy', *run() { const h0 = A.h, x0 = A.x, z0 = A.z; for (let i = 0; i < 6; i++) { const a = h0 + i * PI / 3, x = x0 + Math.sin(a) * 0.25, z = z0 + Math.cos(a) * 0.25; yield* turn(a + PI / 2, 0.1); yield* hop(x, 0.01, z); } yield* hop(x0, 0.01, z0); } },
    rugStretch: { title: 'A big stretch', cost: -0.05, *run() { yield* wait(4, (k, t) => { const s = Math.sin(k * PI); A.aLx = A.aRx = -2.9 * s; A.aLs = A.aRs = SPREAD + 0.3 * s; A.y = 0.01 + 0.03 * s; A.roll = Math.sin(t * 2) * 0.2 * s; }); limbsRest(); } },
    // kids' window
    windowLook: { title: 'Look out at the castle', cost: 0.01, *run() { yield* walkPlan(5.32, 12.6, -PI / 2); yield* wait(4, () => { A.headX = -0.2; A.aLx = A.aRx = -1.2; }); } },
    windowWave: { title: 'Wave at the castle', cost: 0.02, mood: 'happy', *run() { yield* walkPlan(5.32, 12.6, -PI / 2); yield* wait(3.5, wave); } },
    // kitchen
    stir: { title: 'Stir the saucepan', cost: 0.03, mood: 'happy', *run() { yield* stool(4.75, 0.98, PI); inHand(prop('spoon')); const pan = W(4.61, 1.0, 0.34); yield* wait(4, (k, t, dt) => { stir(t); emitEvery(dt, 6, 'puff', pan, { spread: 0.04, v: [0, 0.35, 0], life: 1.6, size: 0.08, grow: 1.5 }); }); yield* offStool(); } },
    kettle: { title: 'Put the kettle on', cost: 0.03, *run() { yield* stool(4.85, 0.98, PI); const spout = W(4.89, 1.1, 0.42); yield* wait(1.2, t => { A.aRx = -1.4; A.aRs = 0.1; }); A.aRx = 0; yield* wait(3, (k, t, dt) => { if (k > 0.3) emitEvery(dt, 12, 'puff', spout, { v: [0, 0.6, 0.2], vr: 0.1, life: 1.2, size: 0.07, grow: 2 }); A.aLx = A.aRx = k > 0.5 ? -2.6 : 0; }); yield* offStool(); } },
    washHands: { title: 'Wash her hands', cost: 0.01, *run() { yield* stool(6.3, 0.98, PI); yield* splash(W(6.3, 1.13, 0.17), 4, t => handsForward(t, 0.15)); yield* offStool(); } },
    washPlate: { title: 'Wash a plate', cost: 0.02, *run() { yield* stool(6.3, 0.98, PI); const p = inHand(prop('plate')); yield* splash(W(6.3, 1.13, 0.17), 4, t => { handsForward(t, 0.1); p.rotation.z = t * 3; }); yield* offStool(); } },
    snack: { title: 'Grab a snack from the fridge', cost: -0.12, mood: 'happy', *run() { yield* fridgeOpen(); yield* wait(1, () => { A.pitch = 0.25; A.aRx = -1.4; }); A.pitch = 0; const y = inHand(prop('yogurt')); fridgeClose(); yield* wait(3, (k, t) => { munch(t); y.scale.setScalar(1 - k * 0.6); }); } },
    milk: { title: 'A drink of milk', cost: -0.1, mood: 'happy', *run() { yield* fridgeOpen(); yield* wait(0.8, () => { A.aRx = -1.4; }); inHand(prop('milk')); fridgeClose(); yield* wait(3, (k, t) => { toMouth(t); A.headX = -0.25; }); } },
    cupcake: { title: 'Eat a cupcake', cost: -0.15, mood: 'happy', *run(spot) { yield* faceSpot(spot); const c = inHand(prop('cupcake')); yield* wait(3, (k, t) => { munch(t); c.scale.setScalar(1 - k * 0.7); }); emit('heart', mouth(), { n: 3, v: [0, 0.4, 0], life: 1.2, size: 0.06 }); } },
    // chairs
    chairEat: { title: 'Sit and eat', cost: -0.1, mood: 'happy', *run(spot) { yield* sit(chairSeat(spot.it)); inHand(prop('fork')); yield* wait(4.5, munch); yield* unsit(); } },
    chairWait: { title: 'Wait for dinner', cost: 0.01, *run(spot) { yield* sit(chairSeat(spot.it)); inHand(prop('fork'), 'L'); inHand(prop('fork')); yield* wait(4, t => { swingLegs(t); A.aLx = A.aRx = -1.6 + Math.sin(t * 6) * 0.15; A.aLs = A.aRs = 0.2; }); yield* unsit(); } },
    chairSwing: { title: 'Swing her legs', cost: 0.01, *run(spot) { yield* sit(chairSeat(spot.it)); yield* wait(4, swingLegs); yield* unsit(); } },
    chairSpin: { title: 'Spin on the chair!', cost: 0.1, mood: 'happy', *run(spot) { const c = spot.it.obj, r0 = c.rotation.y; cleanups.push(() => { c.rotation.y = r0; }); yield* sit(chairSeat(spot.it)); const h0 = A.h; yield* wait(3, k => { const a = ease(k) * PI * 4; c.rotation.y = r0 + a; A.h = h0 + a; A.aLx = A.aRx = -2.6; }); c.rotation.y = r0; A.h = h0; limbsRest(); A.legL = A.legR = -1.35; yield* unsit(); } },
    poufSit: { title: 'Sit on the pouf', cost: 0.01, *run(spot) { const p = spot.it.obj.getWorldPosition(new THREE.Vector3()); yield* sit({ x: p.x, y: p.y + 0.19, z: p.z, h: A.h + PI }); yield* wait(4, swingLegs); yield* unsit(); } },
    // bathroom
    brush: { title: 'Brush her teeth', cost: 0.01, *run() { yield* stool(6.4, 6.22, PI); inHand(prop('toothbrush')); yield* wait(4, (k, t, dt) => { toMouth(t, 0.12); emitEvery(dt, 5, 'bubble', mouth(), { v: [0, 0.15, 0.1], life: 1, size: 0.03 }); }); yield* offStool(); } },
    washFace: { title: 'Wash her face', cost: -0.03, *run() { yield* stool(6.4, 6.22, PI); yield* splash(W(6.4, 1.14, 5.6), 3.5, t => { const up = Math.sin(t * 4) > 0; A.aLx = A.aRx = up ? -2.1 : -1.2; A.aLs = A.aRs = up ? -0.25 : 0; }); yield* offStool(); } },
    floss: { title: 'Floss', cost: 0.01, *run() { yield* stool(6.4, 6.22, PI); yield* wait(4, t => { A.aLx = A.aRx = -2.1; A.aLs = -0.3 + Math.sin(t * 10) * 0.1; A.aRs = -0.3 - Math.sin(t * 10) * 0.1; }); yield* offStool(); } },
    vanityFaces: { title: 'Funny faces in the mirror', cost: 0.02, *run() { yield* stool(6.4, 6.22, PI); yield* funnyFaces(); yield* offStool(); } },
    mirrorFaces: { title: 'Funny faces in the mirror', cost: 0.02, *run(spot) { yield* walk(spot.stand.x, spot.stand.z, PI / 2); yield* funnyFaces(); } },
    mirrorPose: { title: 'Pose in the mirror', cost: 0.01, mood: 'happy', *run(spot) { yield* walk(spot.stand.x, spot.stand.z, PI / 2); const h0 = A.h; for (const d of [0.5, -0.5, 0]) { yield* turn(h0 + d, 0.4); yield* wait(1, () => { A.aLs = A.aRs = 0.9; A.aLx = A.aRx = -0.4; A.headZ = d * 0.4; }); } emit('spark', mouth(), { n: 4, spread: 0.15, v: [0, 0.2, 0], life: 1, size: 0.06 }); } },
    toilet: { title: 'Use the toilet', cost: 0.01, *run() {
      yield* walkPlan(5.76, 8.55); yield* sit(wp(5.76, 0.42, 9.5, PI)); yield* wait(3, t => { swingLegs(t * 0.7); A.headZ = Math.sin(t) * 0.1; }); yield* unsit();
      const bowl = W(5.76, 0.42, 9.55); yield* wait(1.2, (k, t, dt) => { A.aRx = -1.3; emitEvery(dt, 25, 'bubble', bowl, { spread: 0.08, v: [0, 0.1, 0], vr: 0.1, life: 0.8, size: 0.03 }); });
      yield* stool(5.52, 8.65, -PI / 2); yield* splash(W(5.28, 0.98, 8.65), 2.5, t => handsForward(t, 0.15)); yield* offStool(); } },
    basinWash: { title: 'Wash her hands', cost: 0.01, *run() { yield* stool(5.52, 8.65, -PI / 2); yield* splash(W(5.28, 0.98, 8.65), 4, t => handsForward(t, 0.15)); yield* wait(1, (k, t) => { A.aLx = A.aRx = -1.2; A.aLs = A.aRs = 0.5 + Math.sin(t * 30) * 0.25; }); emit('spark', mouth(), { n: 5, spread: 0.15, v: [0, 0.25, 0], life: 1, size: 0.05 }); yield* offStool(); } },
    basinBubbles: { title: 'Wash her hands with lots of bubbles', cost: 0.01, mood: 'happy', *run() { yield* stool(5.52, 8.65, -PI / 2); yield* splash(W(5.28, 0.98, 8.65), 2, t => handsForward(t, 0.15)); yield* wait(2.5, (k, t, dt) => { handsForward(t, 0.15); emitEvery(dt, 8, 'bubble', mouth(), { spread: 0.15, v: [0, 0.3, 0], vr: 0.1, life: 1.6, size: 0.05 }); }); yield* offStool(); } },
    shower: { title: 'Take a shower', cost: -0.05, mood: 'happy', *run() {
      yield* walkPlan(7.2, 8.6); yield* walkPlan(7.05, 9.4, PI); A.y = 0.07; const head = W(7.05, 2.0, 9.72);
      yield* wait(5, (k, t, dt) => { A.aLx = A.aRx = -2.6 + Math.sin(t * 8) * 0.3; A.aLs = A.aRs = -0.1; emitEvery(dt, 40, 'drop', head, { spread: 0.12, v: [0, -1.6, -0.1], vr: 0.1, grav: 3, life: 0.9, size: 0.03 }); emitEvery(dt, 4, 'bubble', mouth(), { spread: 0.12, v: [0, 0.2, 0], life: 1.5, size: 0.04 }); });
      limbsRest(); yield* walkPlan(7.2, 8.6); } },
    // desks
    type: { title: 'Type on the laptop', cost: 0.03, *run() { yield* deskSit(); screen(1); yield* wait(5, t => handsForward(t, 0.1)); } },
    video: { title: 'Watch a video', cost: 0.02, *run() { yield* deskSit(); yield* wait(5, (k, t) => { screen(1, t); A.headZ = Math.sin(t * 0.8) * 0.1; A.aLx = A.aRx = -0.6; }); } },
    draw: { title: 'Draw in the sketchbook', cost: 0.02, mood: 'happy', *run() { yield* kidsSit(); inHand(prop('crayon')); yield* wait(4.5, t => scribble(t)); } },
    colour: { title: 'Colour with crayons', cost: 0.02, mood: 'happy', *run() { yield* kidsSit(); inHand(prop('crayon')); yield* wait(4.5, t => scribble(t, 1.8)); } },
    doodle: { title: 'Doodle and show it off', cost: 0.02, mood: 'happy', *run() { yield* kidsSit(); const c = inHand(prop('crayon')); yield* wait(2.5, t => scribble(t)); c.removeFromParent(); const p = inHand(prop('paper')); p.position.set(0.06, -0.26, 0.06); p.rotation.x = PI / 2; yield* wait(2.5, () => { A.aLx = A.aRx = -2.4; A.aLs = A.aRs = 0; A.headX = 0; }); emit('spark', mouth(), { n: 5, spread: 0.2, v: [0, 0.3, 0], life: 1, size: 0.06 }); } },
    // wardrobes
    wear: { title: 'Wear these clothes', cost: 0.01, mood: 'happy', *run(spot) {
      const p = spot.it.obj.getWorldPosition(new THREE.Vector3());
      yield* faceTo(p.x, p.z);
      yield* blend({ aRx: -2.6, aRs: 0.1 }, 0.4);
      yield* wait(0.3);
      limbsRest();
      const h0 = A.h; let on = false;
      yield* wait(0.9, k => { A.h = h0 + ease(k) * PI * 2; A.y = 0.01 + Math.sin(PI * k) * 0.15; if (k > 0.5 && !on) { on = true; wearColor(spot.it.color); emit('spark', W(0, 0, 0).copy(group.position).setY(0.6), { n: 14, spread: 0.3, v: [0, 0.4, 0], vr: 0.2, life: 1.2, size: 0.07 }); } });
      A.h = h0; A.y = 0.01;
      yield* wait(1, () => { A.aLs = A.aRs = 0.9; A.aLx = A.aRx = -0.4; });
    } },
    tryOn: { title: 'Try on clothes', cost: 0.03, mood: 'happy', *run(spot) { yield* intoWardrobe(spot); yield* wait(1.3); spot.it.on = true; dressUp(); emit('spark', W(0, 0, 0).copy(group.position).setY(0.6), { n: 14, spread: 0.3, v: [0, 0.4, 0], vr: 0.2, life: 1.2, size: 0.07 }); yield* outOfWardrobe(spot); } },
    hide: { title: 'Hide in the wardrobe', cost: 0.02, mood: 'happy', *run(spot) { yield* intoWardrobe(spot); yield* wait(1.5); spot.it.on = true; yield* wait(1.4, k => { A.headZ = 0.35 * Math.sin(k * PI); A.roll = 0.2 * Math.sin(k * PI); }); yield* outOfWardrobe(spot); } },
    // lamps, doors, plants, plushes, the backpack
    lampPlay: { title: 'Switch the lamp on and off', cost: 0.02, mood: 'happy', *run(spot) { const l = lampNamed('floor lamp'), was = l.on; yield* faceSpot(spot); for (let i = 0; i < 6; i++) { yield* wait(0.45, k => { A.aRx = -1.6 - Math.sin(k * PI) * 0.4; }); room.setLamp(l, !l.on); } room.setLamp(l, was); } },
    knock: { title: 'Knock on the door', cost: 0.01, *run(spot) { yield* faceSpot(spot); yield* wait(2.4, knock); } },
    peek: { title: 'Peek round the door', cost: 0.01, *run(spot) { yield* faceSpot(spot); yield* wait(2.5, k => { const s = Math.sin(k * PI); A.roll = -0.25 * s; A.headZ = -0.4 * s; }); } },
    water: { title: 'Water the plant', cost: 0.02, mood: 'happy', *run(spot) { yield* faceSpot(spot); inHand(prop('can')); const at = boxTop(spot); yield* wait(4, (k, t, dt) => { A.aRx = -1.5; A.aRs = 0; emitEvery(dt, 20, 'drop', at, { spread: 0.08, v: [0, -0.3, 0], grav: 2, life: 0.6, size: 0.025 }); }); } },
    sneeze: { title: 'Sniff the leaves... achoo!', cost: 0.01, *run(spot) { yield* faceSpot(spot); yield* wait(1.6, k => { A.pitch = 0.2 * k; A.headX = 0.3 * k; }); emit('puff', mouth(), { n: 8, spread: 0.06, v: [0, 0.1, 0], vr: 0.3, life: 0.8, size: 0.06, grow: 2 }); yield* wait(0.8, k => { A.pitch = 0.2 - 0.35 * Math.sin(k * PI); A.headX = -0.4 * Math.sin(k * PI); }); A.pitch = 0; } },
    plushHug: { title: 'Hug Melody', cost: 0.01, mood: 'happy', *run(spot) { yield* faceSpot(spot); yield* hug(spot.it, 3.5); } },
    plushDance: { title: 'Dance with Melody!', cost: 0.14, mood: 'happy', *run(spot) { yield* faceSpot(spot); borrow(spot.it.obj, group, new THREE.Vector3(0, 0.32, 0.2)); yield* dance(4); } },
    plushTuck: { title: 'Tuck Melody in for a nap', cost: 0.01, *run(spot) { yield* faceSpot(spot); yield* tuckIn(spot.it); } },
    bagLook: { title: 'Look in the backpack', cost: 0.01, *run(spot) { yield* faceSpot(spot); borrow(spot.it.obj, group, new THREE.Vector3(0, 0.33, 0.24)); yield* wait(3.5, t => { A.headX = 0.45; A.aLx = A.aRx = -1.3 + Math.sin(t * 9) * 0.1; A.aLs = A.aRs = -0.1; }); const s = inHand(prop('strawberry')); yield* wait(1.5, munch); s.removeFromParent(); } },
    bagMarch: { title: 'Put the backpack on and march!', cost: 0.12, mood: 'happy', *run(spot) { yield* faceSpot(spot); borrow(spot.it.obj, group, new THREE.Vector3(0, 0.36, -0.17), new THREE.Euler(0, PI, 0)); const h0 = A.h, x0 = A.x, z0 = A.z; yield* wait(5, (k, t) => { const a = h0 + k * PI * 2; A.h = a + PI / 2; A.x = x0 + (Math.sin(a) - Math.sin(h0)) * 0.3; A.z = z0 + (Math.cos(a) - Math.cos(h0)) * 0.3; const s = Math.sin(t * 9); A.legL = s * 0.6; A.legR = -s * 0.6; A.aLx = -s * 0.8; A.aRx = s * 0.8; A.y = 0.01 + Math.abs(s) * 0.03; }); limbsRest(); A.x = x0; A.z = z0; A.h = h0; } },
  };

  // ---------- pieces the activities share ----------
  const wp = (x, y, z, h) => { const v = W(x, y, z); return { x: v.x, y, z: v.z, h }; };
  function* sleep(sec) {
    feelings.set('sleepy', sec + 1);
    yield* wait(sec, (k, t, dt) => { A.aLx = A.aRx = -0.3; emitEvery(dt, 0.9, 'z', mouth(), { v: [0, 0.25, 0], vr: 0.05, life: 2, size: 0.07, grow: 0.5 }); });
    feelings.set('happy', 4);                                // wakes up refreshed
  }
  function* onTop(x, y, z) { const v = W(x, y, z); topFrom = { x: A.x, z: A.z }; yield* faceTo(v.x, v.z); yield* hop(v.x, y, v.z); }
  let topFrom = null;
  function* offTop() { yield* hop(topFrom.x, 0.01, topFrom.z); }
  function* floorLie(tummy) { const [fx, fz] = forward(A.h); yield* lie({ x: A.x + fx * 0.45, y: 0.0, z: A.z + fz * 0.45, h: A.h }, tummy); }
  function* climb() {
    const foot = W(7.98, 0, 11.92), top = W(8.55, 1.56, 11.92);
    yield* walk(foot.x, foot.z, PI / 2);
    yield* wait(2.2, (k, t) => { A.y = 0.01 + k * 1.3; const s = Math.sin(t * 8); A.aLx = -2.6 + s * 0.4; A.aRx = -2.6 - s * 0.4; A.legL = -0.5 + s * 0.4; A.legR = -0.5 - s * 0.4; });
    limbsRest();
    yield* hop(top.x, 1.56, top.z);
  }
  function* climbDown() {
    const foot = W(7.98, 0, 11.92), top = W(8.55, 1.56, 11.92);
    yield* walk(top.x, top.z, PI / 2);
    yield* hop(foot.x, 1.3, foot.z);
    yield* wait(1.8, (k, t) => { A.y = 1.3 - k * 1.29; const s = Math.sin(t * 8); A.aLx = -2.6 + s * 0.4; A.aRx = -2.6 - s * 0.4; A.legL = -0.5 + s * 0.4; A.legR = -0.5 - s * 0.4; });
    limbsRest(); A.y = 0.01;
  }
  const boxTop = spot => { const b = boundsOf(spot), c = b.getCenter(new THREE.Vector3()); c.y = b.max.y + 0.05; return c; };
  function* faceSpot(spot) { const c = boundsOf(spot).getCenter(new THREE.Vector3()); yield* faceTo(c.x, c.z); }
  function* splash(tap, sec, pose) {
    yield* wait(sec, (k, t, dt) => {
      pose(t);
      emitEvery(dt, 30, 'drop', tap, { spread: 0.01, v: [0, -0.8, 0], vr: 0.03, grav: 3, life: 0.35, size: 0.022 });
      emitEvery(dt, 8, 'drop', handAt(), { spread: 0.04, v: [0, 0.4, 0], vr: 0.35, grav: 4, life: 0.5, size: 0.02 });
    });
    limbsRest();
  }
  function* funnyFaces() {
    for (const f of ['angry', 'sad', 'bored', 'happy', 'angry', 'happy']) { feelings.set(f, 2); yield* wait(0.6, (k, t) => { A.headZ = Math.sin(t * 9) * 0.2; }); }
    feelings.set('happy', 3);
  }
  function tvOn() { const tv = sw('TV'); if (tv && !tv.on) tv.on = true; }
  function* fridgeOpen() { const f = sw('fridge'); yield* walkPlan(7.55, 1.15, PI); if (!f.on) { f.on = true; yield* wait(0.8); } }
  function fridgeClose() { const f = sw('fridge'); if (f) f.on = false; }
  function* deskSit() { const c = chairNear(4.09, 8.75); if (c) yield* sit(chairSeat(c)); else yield* walkPlan(4.12, 8.75, PI / 2); }
  function* kidsSit() { const c = chairNear(6.7, 10.91); if (c) yield* sit(chairSeat(c)); else yield* walkPlan(6.7, 10.95, PI); }
  let laptopScreen = null;
  function screen(level, t = 0) {                           // the laptop's screen lights up (and changes colour for a video)
    if (!laptopScreen) {
      const lap = named('laptop')[0];
      lap?.obj.traverse(o => { if (o.material && o.material.emissiveIntensity === 0.25) laptopScreen = o.material; });
      if (!laptopScreen) return;
      laptopScreen.userData.rest = laptopScreen.emissive.getHex();
    }
    const m = laptopScreen;
    if (t) m.emissive.setHSL((t * 0.15) % 1, 0.6, 0.5); else m.emissive.set(0x9fb6ff);
    m.emissiveIntensity = level * 1.4;
    if (!screenLit) { screenLit = true; cleanups.push(() => { m.emissive.setHex(m.userData.rest); m.emissiveIntensity = 0.25; screenLit = false; }); }
  }
  let screenLit = false;
  function* intoWardrobe(spot) {
    const w = spot.it.obj, front = w.localToWorld(new THREE.Vector3(0, 0, spot.depth / 2 + 0.45)), inside = w.localToWorld(new THREE.Vector3(0, 0, 0.0));
    const out = new THREE.Euler().setFromQuaternion(w.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    yield* walk(front.x, front.z);
    if (!spot.it.on) { spot.it.on = true; yield* wait(1.1); }
    yield* walk(inside.x, inside.z, out);
    spot.it.on = false;
  }
  function* outOfWardrobe(spot) {
    const w = spot.it.obj, front = w.localToWorld(new THREE.Vector3(0, 0, spot.depth / 2 + 0.45));
    yield* wait(1.0);
    yield* walk(front.x, front.z);
    spot.it.on = false;
  }
  let dressTimer = 0;
  function dressUp() { squirrel.setDress(pick(DRESSES)); dressTimer = 25; }   // her own pink dress comes back after a while
  function wearColor(c) { if (c) squirrel.setDress(c); dressTimer = 0; }       // clothes she chose: she keeps them on
  function* hug(it, sec, sitting = false) {
    borrow(it.obj, group, new THREE.Vector3(0, sitting ? 0.36 : 0.33, 0.17));
    yield* wait(sec, (k, t, dt) => {
      A.aLx = A.aRx = -1.35; A.aLs = A.aRs = -0.32; A.roll = Math.sin(t * 2.2) * 0.12; A.headZ = 0.15;
      if (sitting) swingLegs(t * 0.5);
      emitEvery(dt, 1.5, 'heart', mouth(), { v: [0, 0.35, 0], vr: 0.1, life: 1.3, size: 0.06 });
    });
    A.roll = 0;
  }
  function* tuckIn(it) {
    const o = it.obj, q0 = o.quaternion.clone(), y0 = o.position.y;
    yield* wait(1, k => { A.pitch = 0.3 * Math.sin(k * PI); A.aRx = -1.2; });
    o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PI / 2));
    o.position.y = y0 + 0.07 * o.getWorldScale(new THREE.Vector3()).y;
    it.dirty = true;
    const z = boxTop({ it, obj: o });
    yield* wait(2.5, (k, t, dt) => { A.pitch = 0.2; A.aRx = -1.1 + Math.max(0, Math.sin(t * 7)) * 0.3; emitEvery(dt, 1, 'z', z, { v: [0, 0.2, 0], life: 1.8, size: 0.06 }); });
    A.pitch = 0;
    void q0;   // she stays tucked in until someone picks her up
  }
  function* stackBlocks() {
    const [fx, fz] = forward(A.h), base = new THREE.Vector3(A.x + fx * 0.32, 0, A.z + fz * 0.32);
    for (let i = 0; i < 3; i++) {
      const b = prop('block'); inHand(b);
      yield* wait(0.6, k => { A.aRx = -1.2 - k * 0.3; });
      b.removeFromParent(); place(b, base.clone().setY(i * 0.07)); b.rotation.y = Math.random();
      yield* wait(0.4, () => { A.aRx = -0.6; });
    }
    yield* wait(1.2, t => { A.aLx = A.aRx = -1.4 + Math.abs(Math.sin(t * 10)) * 0.4; A.aLs = A.aRs = -0.2; });
  }
  function* rollBall() {
    const [fx, fz] = forward(A.h), b = place(prop('ball'), new THREE.Vector3(A.x + fx * 0.3, 0, A.z + fz * 0.3)), x0 = b.position.x, z0 = b.position.z;
    yield* wait(3.5, (k, t) => {
      const d = Math.sin(k * PI) * 0.9; b.position.x = x0 + fx * d; b.position.z = z0 + fz * d; b.rotation.x = d * 15;
      A.aLx = A.aRx = k < 0.15 || k > 0.85 ? -1.0 : -0.3;
    });
  }

  // ---------- the things in the room, and what each offers ----------
  // A spot is a box in plan metres, or one of the room's movable things.
  const box = (x0, x1, y0, y1, z0, z1) => new THREE.Box3(W(x0, y0, z0), W(x1, y1, z1));
  const spots = [
    { box: box(8.3, 9.4, 0, 1.9, 10.15, 12.2), acts: ['bunkSleepLow', 'bunkSitLow', 'bunkClimbSleep', 'bunkClimbJump'] },
    { box: box(0.12, 2.2, 0, 0.9, 6.9, 8.5), acts: ['bedSleep', 'bedSit', 'bedBounce', 'bedHug'] },
    { box: box(1.7, 3.7, 0, 0.85, 0.04, 0.96), acts: ['sofaSit', 'sofaNap', 'sofaBounce'] },
    { box: box(0.04, 0.92, 0, 0.85, 1.25, 2.75), acts: ['loveSit', 'loveWindow', 'loveNap'] },
    { box: box(2.2, 3.2, 0, 0.5, 1.47, 2.03), acts: ['sip', 'strawberry'] },
    { box: box(1.8, 3.1, 0.5, 1.4, 3.6, 3.85), acts: ['tvWatch', 'tvDance'], reach: 1.2 },
    { box: box(1.8, 3.1, 0.05, 0.35, 3.25, 3.9), acts: ['stack', 'rollBall'] },
    { box: box(1.35, 3.85, 0, 0.03, 1.1, 2.9), acts: ['rugDance', 'rugRoll', 'rugTummy'], rug: true },
    { box: box(2.05, 3.75, 0, 0.03, 6.85, 8.55), acts: ['rugStretch', 'rugDance'], rug: true },
    { box: box(6.1, 7.7, 0, 0.03, 11.35, 12.95), acts: ['rugDance', 'rugCeiling', 'rugHop'], rug: true },
    { box: box(4.7, 5.05, 0.85, 2.25, 12.05, 13.15), acts: ['windowLook', 'windowWave'] },
    { box: box(4.45, 5.05, 0, 1.1, 0, 0.62), acts: ['stir', 'kettle'] },
    { box: box(6.05, 6.55, 0, 1.15, 0, 0.62), acts: ['washHands', 'washPlate'] },
    { box: box(7.19, 7.91, 0, 1.72, 0.01, 0.67), acts: ['snack', 'milk'] },
    { box: box(5.32, 7.48, 0, 1.0, 5.46, 6.0), acts: ['brush', 'washFace', 'floss', 'vanityFaces'] },
    { box: box(9.2, 9.4, 0.8, 1.85, 6.35, 7.15), acts: ['mirrorFaces', 'mirrorPose'], stand: W(8.95, 0, 6.75) },
    { box: box(9.2, 9.4, 0.2, 1.8, 8.3, 8.9), acts: ['mirrorFaces', 'mirrorPose'], stand: W(8.95, 0, 8.6) },
    { box: box(5.5, 6.05, 0, 1.0, 9.0, 9.94), acts: ['toilet'] },
    { box: box(5.06, 5.32, 0.7, 1.0, 8.42, 8.88), acts: ['basinWash', 'basinBubbles'] },   // the little basin by the toilet
    { box: box(6.56, 7.54, 0, 2.0, 8.97, 9.94), acts: ['shower'] },
    { box: box(4.38, 4.94, 0, 0.8, 8.2, 9.3), acts: ['type', 'video'] },
    { box: box(6.05, 7.35, 0, 0.7, 10.06, 10.6), acts: ['draw', 'colour', 'doodle'] },
    { box: box(4.36, 4.64, 0, 1.66, 7.78, 8.06), acts: ['lampPlay'] },
  ];
  // the movable things: wherever they have been put
  const kidsChair = named('chair').find(c => c.obj.scale.x < 0.9);
  for (const it of named('chair')) if (it !== kidsChair && it.obj.getWorldPosition(new THREE.Vector3()).x > 1.5) spots.push({ it, acts: ['chairEat', 'chairWait'] });
  if (kidsChair) spots.push({ it: kidsChair, acts: ['chairSwing', 'chairSpin'] });
  for (const it of named('wardrobe')) {
    const b = new THREE.Box3().setFromObject(it.obj), size = b.getSize(new THREE.Vector3());
    spots.push({ it, acts: ['tryOn', 'hide'], depth: Math.min(size.x, size.z) });
  }
  for (const it of named('Melody plush')) spots.push({ it, acts: ['plushHug', 'plushDance', 'plushTuck'] });
  for (const it of named('plant')) spots.push({ it, acts: ['water', 'sneeze'] });
  for (const it of named('door')) spots.push({ it, acts: ['knock', 'peek'] });
  for (const name of ['cupcakes']) for (const it of named(name)) spots.push({ it, acts: ['cupcake'] });
  for (const it of named('pouf')) spots.push({ it, acts: ['poufSit'] });
  for (const it of named('backpack')) spots.push({ it, acts: ['bagLook', 'bagMarch'] });

  const wearSpots = new Map();
  const wearSpot = it => { if (!wearSpots.has(it)) wearSpots.set(it, { it, acts: ['wear'] }); return wearSpots.get(it); };
  const boundsOf = spot => spot.box || new THREE.Box3().setFromObject(spot.it.obj);
  // a plush near a place (world), not being carried
  const plushNear = (at, r) => named('Melody plush').find(p => !isCarried(p.obj) && p.obj.getWorldPosition(new THREE.Vector3()).distanceTo(at) < r);

  // the nearest spot she could use: within reach, not behind her; rugs only when nothing else is near
  function nearest() {
    const p = group.position, fx = Math.sin(walker.heading), fz = Math.cos(walker.heading);
    let best = null, bestScore = Infinity;
    for (const spot of spots) {
      if (spot.it && isCarried(spot.it.obj)) continue;
      if (spot.it && p.distanceToSquared(spot.it.obj.getWorldPosition(tmp)) > 9) continue;
      const b = boundsOf(spot);
      if (b.min.y > 1.9) continue;
      const dx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x) - p.x, dz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z) - p.z, d = Math.hypot(dx, dz);
      if (d > 0.2 + (spot.reach ?? 0.35)) continue;
      const facing = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
      if (facing < -0.2 && !spot.rug) continue;
      const score = d - 0.2 * facing + (spot.rug ? 0.45 : 0);
      if (score < bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }
  const tmp = new THREE.Vector3();

  // ---------- running one ----------
  let job = null, current = null, last = null, repeats = 0;
  function begin(spot) {
    const choices = spot.acts.filter(id => !ACT[id].ok || ACT[id].ok());
    let id = pick(choices), act = ACT[id];
    Object.assign(A, { x: group.position.x, y: 0.01, z: group.position.z, h: walker.heading, pitch: 0 });
    limbsRest();
    const home = { x: A.x, z: A.z, h: A.h };
    if (act.cost > 0.06 && feelings.energy < 0.15) {        // too tired to play
      act = { title: 'Too sleepy to play... time for a nap', cost: 0, *run() { feelings.set('sleepy', 6); yield* wait(3, (k, t) => { A.headX = 0.3 + Math.sin(t * 1.5) * 0.15; A.aLx = A.aRx = 0.1; }); } };
      id = 'tired';
    }
    repeats = id === last && id !== 'wear' ? repeats + 1 : 1;
    last = id;
    if (act.mood) feelings.set(act.mood, 8);
    feelings.event('use');
    cleanups = [];
    seated = false;
    const gen = (function* () {
      yield* act.run(spot);
      if (seated) yield* unsit();                           // the desks: she is still on the chair
      limbsRest();
      if (A.y > 0.05 || A.pitch) yield* blend({ y: 0.01, pitch: 0 }, 0.3);
      yield* walk(home.x, home.z, home.h);
    })();
    gen.next();
    job = { gen, act, home };
    showCaption(act.title);
  }
  function end(aborted) {
    const { act, home } = job;
    cleanups.reverse().forEach(f => f());
    cleanups = [];
    stoolProp = null;
    seated = false;
    if (aborted) { group.position.x = home.x; group.position.z = home.z; }
    group.rotation.set(0, A.h, 0);
    walker.place(aborted ? home.x : A.x, aborted ? home.z : A.z, aborted ? home.h : A.h);
    job = null;
    showCaption(null);
    if (!aborted) {
      feelings.spend(act.cost);
      if (repeats >= 3) { feelings.set('bored', 6); repeats = 0; }
    }
  }

  addEventListener('keydown', e => {
    if (e.code !== 'KeyR' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (job || interaction.carry || !current) return;
    begin(current);
  });

  const at = new THREE.Vector3();
  function pin(el, v, lift = 0) {
    at.copy(v).project(camera);
    if (at.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    el.style.left = `${THREE.MathUtils.clamp((at.x * 0.5 + 0.5) * innerWidth, 40, innerWidth - 40)}px`;
    el.style.top = `${THREE.MathUtils.clamp((-at.y * 0.5 + 0.5) * innerHeight - lift, 120, innerHeight - 40)}px`;
  }
  let captionText = null;
  function showCaption(text) { captionText = text; caption.hidden = !text; if (text) caption.textContent = text; }

  // step: what the walker reported this frame (a walking key held stops an activity)
  function update(dt, step) {
    updateSparks(dt);
    if (dressTimer > 0 && (dressTimer -= dt) <= 0) squirrel.setDress();
    if (job && step.input && !job.leaving) {
      if (seated) {                                         // sitting: an arrow key gets her up, off the seat
        job.leaving = true;
        job.gen = hopOff();
        job.gen.next();
        showCaption(null);
      } else end(true);
    }
    if (job && (!step.input || job.leaving)) {
      const r = job.gen.next(dt);
      applyPose();
      if (r.done) end(false);
    }
    const lit = interaction.current;                       // clothes lit up: R puts them on
    current = job || interaction.carry ? null : lit && lit.name === 'clothes' && lit.color ? wearSpot(lit) : nearest();
    if (current) { const b = boundsOf(current), c = b.getCenter(new THREE.Vector3()); c.y = Math.min(b.max.y, 1.9) + 0.25; pin(bubble, c); }
    else bubble.hidden = true;
    if (captionText) pin(caption, group.position.clone().setY(group.position.y + 1.2));
  }

  return {
    update, get busy() { return !!job; },
    // console helpers: do an activity by name next to whatever is nearest, and list what is near
    play: id => {
      if (job) return;
      const p = group.position, d = s => boundsOf(s).distanceToPoint(p);
      const s = spots.filter(sp => sp.acts.includes(id) && !(sp.it && isCarried(sp.it.obj))).sort((a, b) => d(a) - d(b))[0];
      if (s) { const keep = s.acts; s.acts = [id]; begin(s); s.acts = keep; }
    },
    get near() { return current ? current.acts : null; },
    // console helper: fast-forward the running activity by `seconds` (to look at a pose)
    skip(seconds) { for (let t = 0; job && t < seconds; t += 1 / 30) { const r = job.gen.next(1 / 30); applyPose(); updateSparks(1 / 30); if (r.done) end(false); } },
    // console helper for checking: stand her by each thing and run every activity it offers at full speed
    test() {
      const report = [];
      testing = true;
      for (const spot of spots) for (const id of spot.acts) {
        if (job) end(true);
        const b = boundsOf(spot), c = b.getCenter(new THREE.Vector3()), r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 0.35;
        let at = null;
        for (const rr of [r, r + 0.2, r + 0.4, r + 0.7]) for (let i = 0; i < 16 && !at; i++) { const a = i / 16 * PI * 2, x = c.x + Math.sin(a) * rr, z = c.z + Math.cos(a) * rr; if (walker.isFree(x, z)) at = [x, z, a + PI]; }
        if (!at) { report.push(`${id}: nowhere to stand`); continue; }
        walker.place(...at); group.position.set(at[0], 0.01, at[1]);
        if (ACT[id].ok && !ACT[id].ok()) { report.push(`${id}: skipped (not available here)`); continue; }
        const keep = spot.acts; spot.acts = [id];
        try {
          begin(spot); spot.acts = keep;
          let t = 0;
          while (job && t < 90) { const r2 = job.gen.next(1 / 30); applyPose(); t += 1 / 30; if (r2.done) end(false); }
          if (job) { report.push(`${id}: still going after 90 s`); end(true); }
          const p = group.position;
          if (Math.hypot(p.x - at[0], p.z - at[1]) > 0.05) report.push(`${id}: ended away from where she started`);
        } catch (err) { spot.acts = keep; report.push(`${id}: ERROR ${err.message}`); if (job) { try { end(true); } catch (e) { job = null; } } }
      }
      testing = false;
      return report.length ? report : ['all fine'];
    },
  };
}
