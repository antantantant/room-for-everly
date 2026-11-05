// Walking the squirrel round the home with the arrow keys (or WASD).
//
// Where she can go comes from pictures of the home taken from above, keeping
// only what lies below knee height: each pixel records the height of the highest
// thing there. Bare floor and rugs are walkable; walls, furniture and the open
// courtyards (where there is no floor at all) are not. Seen straight down a wall
// is only an edge, so four more pictures are taken looking down at a slant, one
// from each side, which shows the walls' faces too. The map therefore always
// matches the furniture, wherever it is placed.
import * as THREE from 'three';

const CELL = 0.025;                         // metres per pixel of the floor map
const BOUNDS = { x0: -5, x1: 5, z0: -7.2, z1: 7.2 };
const CUT = 1.0;                            // things higher than this cannot get in her way
const STEP = 0.07;                          // anything lower than this is floor (rugs, door sills)
const RADIUS = 0.2;                         // how much room she needs around her middle
const SPEED = 0.95;                         // walking speed, m/s
const STRIDE = 7.2;                         // walk-cycle radians per metre walked

function floorMap(scene, renderer, hidden) {
  const W = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL), D = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
  const cam = new THREE.OrthographicCamera(-W * CELL / 2, W * CELL / 2, D * CELL / 2, -D * CELL / 2, 0.1, 10);
  cam.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, 5, (BOUNDS.z0 + BOUNDS.z1) / 2);
  cam.up.set(0, 0, -1);                     // screen right is +x, screen up is -z
  cam.lookAt(cam.position.x, 0, cam.position.z);
  cam.updateMatrixWorld(true);
  const height = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uSlant: { value: new THREE.Vector2() } },
    vertexShader: `uniform vec2 uSlant; varying float h;
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 w = modelMatrix * p;
        h = w.y;
        w.xz += uSlant * w.y;              // lean the view so upright faces show
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `varying float h;
      void main() {
        if (h > ${CUT.toFixed(2)}) discard;    // the ceiling, the tops of walls and wardrobes
        gl_FragColor = vec4(clamp(h, 0.0, 1.0), 0.0, 0.0, 1.0);
      }`,
  });
  const target = new THREE.WebGLRenderTarget(W, D);
  const was = hidden.map(o => o.visible), bg = scene.background, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  hidden.forEach(o => { o.visible = false; });
  scene.overrideMaterial = height;
  scene.background = null;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0xff0000, 1);      // nothing there (no floor) reads as blocked
  const blocked = new Uint8Array(W * D), top = new Uint8Array(W * D), px = new Uint8Array(W * D * 4);
  for (const [sx, sz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
    height.uniforms.uSlant.value.set(sx, sz);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, W, D, px);
    for (let k = 0; k < W * D; k++) if (px[k * 4] > STEP * 255) blocked[k] = 1;
    if (!sx && !sz) for (let k = 0; k < W * D; k++) top[k] = px[k * 4];   // the straight-down picture: how high the top of things is
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);
  scene.overrideMaterial = null;
  scene.background = bg;
  hidden.forEach((o, i) => { o.visible = was[i]; });
  target.dispose();
  height.dispose();

  // pixel row j counts up from the bottom of the picture, which is the +z edge
  const cellOf = (x, z) => {
    const i = Math.floor((x - BOUNDS.x0) / CELL), j = Math.floor((BOUNDS.z1 - z) / CELL);
    return i < 0 || j < 0 || i >= W || j >= D ? -1 : j * W + i;
  };
  const solidAt = (x, z) => { const k = cellOf(x, z); return k < 0 || blocked[k] === 1; };
  // the height of the highest thing under knee height at (x, z); Infinity where there is no floor or it is taller
  const heightAt = (x, z) => { const k = cellOf(x, z); return k < 0 || top[k] === 255 ? Infinity : top[k] / 255; };
  // free if her middle and a ring round her are all on open floor
  const ring = Array.from({ length: 16 }, (_, k) => [Math.cos(k / 16 * Math.PI * 2), Math.sin(k / 16 * Math.PI * 2)]);
  const isFree = (x, z, r = RADIUS) => !solidAt(x, z) && ring.every(([c, s]) => !solidAt(x + c * r, z + s * r) && !solidAt(x + c * r * 0.5, z + s * r * 0.5));
  return { isFree, heightAt };
}

// How each feeling shows in her body. The numbers blend smoothly from one feeling to the next.
const STYLE = {
  neutral: { speed: 1, wag: 1, tailRate: 2.4, bounce: 1, hop: 0, headX: 0, tilt: 0, nod: 0, droop: 0, arms: 0, shake: 0, sleepy: 0 },
  happy: { speed: 1.15, wag: 1.8, tailRate: 5.5, bounce: 1.8, hop: 1, headX: -0.06, tilt: 0, nod: 0, droop: -0.05, arms: -0.2, shake: 0, sleepy: 0 },
  sad: { speed: 0.6, wag: 0.3, tailRate: 1.2, bounce: 0.4, hop: 0, headX: 0.32, tilt: 0.05, nod: 0, droop: 0.3, arms: 0.12, shake: 0, sleepy: 0 },
  angry: { speed: 1.1, wag: 0.5, tailRate: 9, bounce: 2.4, hop: 0, headX: 0.12, tilt: 0, nod: 0, droop: -0.1, arms: -0.35, shake: 1, sleepy: 0 },
  bored: { speed: 0.75, wag: 0.5, tailRate: 1.1, bounce: 0.6, hop: 0, headX: 0.06, tilt: 0.2, nod: 0, droop: 0.12, arms: 0.05, shake: 0, sleepy: 0 },
  sleepy: { speed: 0.5, wag: 0.25, tailRate: 0.8, bounce: 0.4, hop: 0, headX: 0.22, tilt: 0.08, nod: 1, droop: 0.25, arms: 0.1, shake: 0, sleepy: 1 },
};

export function createWalker({ squirrel, scene, renderer, camera, controls, hidden }) {
  const { group, parts } = squirrel;
  let map = floorMap(scene, renderer, [...hidden, group]);
  const isFree = (x, z, r) => map.isFree(x, z, r);
  // redraw the map after something has been moved, opened or shut
  const refresh = () => { map = floorMap(scene, renderer, [...hidden, group]); };

  // if she was put somewhere she does not fit, nudge her to the nearest open floor
  if (!isFree(group.position.x, group.position.z)) {
    outer: for (let r = CELL; r < 2; r += CELL) for (let k = 0; k < 24; k++) {
      const x = group.position.x + Math.cos(k / 24 * Math.PI * 2) * r, z = group.position.z + Math.sin(k / 24 * Math.PI * 2) * r;
      if (isFree(x, z)) { group.position.x = x; group.position.z = z; break outer; }
    }
  }

  const keys = new Set();
  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(k);
    e.preventDefault();
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
  addEventListener('blur', () => keys.clear());

  const baseTailY = parts.tail.rotation.y, arms = [[parts.armL, 1], [parts.armR, -1]], legs = [[parts.legL, 1], [parts.legR, -1]];
  const baseArmZ = parts.armL.rotation.z;
  let heading = group.rotation.y, phase = 0, walk = 0, time = 0, front = 0, over = 0;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const style = { ...STYLE.neutral };

  // Moves and animates her. `mood` is how she feels; `carry` is 'front', 'over'
  // (above her head) or nothing. Returns whether she walked, whether she walked
  // into something, and whether any walking key is held.
  function update(dt, { mood = 'neutral', carry } = {}) {
    time += dt;
    const want = STYLE[mood] || STYLE.neutral, ease = Math.min(1, dt * 4);
    for (const k in style) style[k] += (want[k] - style[k]) * ease;
    front += ((carry === 'front' ? 1 : 0) - front) * Math.min(1, dt * 10);
    over += ((carry === 'over' ? 1 : 0) - over) * Math.min(1, dt * 10);
    // directions are the screen's: up walks away from the camera, left walks to the screen's left
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up);
    move.set(0, 0, 0);
    if (keys.has('up')) move.add(forward);
    if (keys.has('down')) move.sub(forward);
    if (keys.has('right')) move.add(right);
    if (keys.has('left')) move.sub(right);
    let walked = 0, bumped = false;
    if (move.lengthSq() > 0) {
      move.normalize();
      // turn to face the way she is going, the short way round
      const want = Math.atan2(move.x, move.z);
      let d = want - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading += d * Math.min(1, dt * 12);
      // step, sliding along walls rather than stopping dead; if something has been
      // put down on top of her, she can walk out of it
      const step = SPEED * style.speed * dt, p = group.position, x0 = p.x, z0 = p.z;
      const nx = x0 + move.x * step, nz = z0 + move.z * step;
      if (!isFree(x0, z0) || isFree(nx, nz)) { p.x = nx; p.z = nz; }
      else if (isFree(nx, z0)) p.x = nx;
      else if (isFree(x0, nz)) p.z = nz;
      walked = Math.hypot(p.x - x0, p.z - z0);
      bumped = walked < step * 0.3;
      if (walked) {
        // the camera comes along, keeping whatever angle the viewer chose
        camera.position.x += p.x - x0; camera.position.z += p.z - z0;
        controls.target.x += p.x - x0; controls.target.z += p.z - z0;
      }
    }
    const goal = move.lengthSq() > 0 ? 1 : 0;
    walk += (goal - walk) * Math.min(1, dt * 8);
    phase += walked * STRIDE;

    // the walk: legs and arms swing in opposite pairs, a little bounce and waddle
    const s = Math.sin(phase), idle = 1 - walk, carrying = front + over;
    for (const [leg, side] of legs) leg.rotation.x = side * s * 0.5 * walk;
    for (const [arm, side] of arms) {
      const swing = -side * s * 0.6 * walk * (1 - carrying) + Math.sin(time * 1.6 + side) * 0.03 + style.arms
        + style.shake * Math.sin(time * 22 + side) * 0.06 * idle;
      arm.rotation.x = swing * (1 - carrying) - 1.25 * front - 2.9 * over;      // holding something out in front, or up over her head
      arm.rotation.z = side * (baseArmZ * (1 - carrying) + 0.18 * carrying);
    }
    const hop = style.hop * idle * Math.max(0, Math.sin(time * 7)) * 0.035;      // little happy bounces when standing
    group.rotation.set(0, heading, Math.sin(phase) * 0.05 * walk);
    group.position.y = 0.01 + Math.abs(s) * 0.022 * walk * style.bounce + hop;
    parts.head.rotation.z = -s * 0.04 * walk + Math.sin(time * 0.9) * 0.025 + style.tilt;
    parts.head.rotation.x = Math.sin(time * 1.3) * 0.015 + style.headX + style.nod * (0.5 + 0.5 * Math.sin(time * 0.9)) * 0.18;
    // the tail waves all the time: wags when she is happy, flicks when she is cross, droops when she is low
    const wag = (1 + walk) * style.wag;
    parts.tail.rotation.z = Math.sin(time * style.tailRate) * 0.07 * wag;
    parts.tail.rotation.y = baseTailY + Math.sin(time * style.tailRate + 0.6) * 0.08 * wag;
    parts.tail.rotation.x = Math.sin(time * 1.7) * 0.04 + s * 0.05 * walk - style.droop;
    // sleepy: Zs drift up from her head
    parts.zzz.visible = style.sleepy > 0.5;
    if (parts.zzz.visible) parts.zzz.children.forEach((z, i) => {
      const f = (time * 0.45 + i / 3) % 1;
      z.position.set(0.16 + f * 0.16, 0.42 + f * 0.32, 0.02);
      z.scale.setScalar(0.05 + f * 0.07);
      z.material.opacity = Math.min(1, (1 - f) * 2) * Math.min(1, f * 6);
    });
    return { walked: walked > 0, bumped, input: move.lengthSq() > 0 };
  }

  return {
    update, isFree, refresh,
    heightAt: (x, z) => map.heightAt(x, z),
    get heading() { return heading; },
    // put her somewhere, facing `h` (radians; 0 faces +z), bringing the camera along
    place(x, z, h = heading) {
      camera.position.x += x - group.position.x; camera.position.z += z - group.position.z;
      controls.target.x += x - group.position.x; controls.target.z += z - group.position.z;
      group.position.x = x; group.position.z = z; heading = h;
    },
  };
}
