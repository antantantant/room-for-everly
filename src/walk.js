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
  const blocked = new Uint8Array(W * D), px = new Uint8Array(W * D * 4);
  for (const [sx, sz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
    height.uniforms.uSlant.value.set(sx, sz);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, W, D, px);
    for (let k = 0; k < W * D; k++) if (px[k * 4] > STEP * 255) blocked[k] = 1;
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);
  scene.overrideMaterial = null;
  scene.background = bg;
  hidden.forEach((o, i) => { o.visible = was[i]; });
  target.dispose();
  height.dispose();

  // pixel row j counts up from the bottom of the picture, which is the +z edge
  const solidAt = (x, z) => {
    const i = Math.floor((x - BOUNDS.x0) / CELL), j = Math.floor((BOUNDS.z1 - z) / CELL);
    return i < 0 || j < 0 || i >= W || j >= D || blocked[j * W + i] === 1;
  };
  // free if her middle and a ring round her are all on open floor
  const ring = Array.from({ length: 16 }, (_, k) => [Math.cos(k / 16 * Math.PI * 2), Math.sin(k / 16 * Math.PI * 2)]);
  const isFree = (x, z, r = RADIUS) => !solidAt(x, z) && ring.every(([c, s]) => !solidAt(x + c * r, z + s * r) && !solidAt(x + c * r * 0.5, z + s * r * 0.5));
  return { isFree };
}

export function createWalker({ squirrel, scene, renderer, camera, controls, hidden }) {
  const { group, parts } = squirrel;
  const { isFree } = floorMap(scene, renderer, [...hidden, group]);

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
  let heading = group.rotation.y, phase = 0, walk = 0, time = 0;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // Moves and animates her. Returns true when she walked this frame.
  function update(dt) {
    time += dt;
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
    let walked = 0;
    if (move.lengthSq() > 0) {
      move.normalize();
      // turn to face the way she is going, the short way round
      const want = Math.atan2(move.x, move.z);
      let d = want - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading += d * Math.min(1, dt * 12);
      // step, sliding along walls rather than stopping dead
      const step = SPEED * dt, p = group.position, x0 = p.x, z0 = p.z;
      const nx = x0 + move.x * step, nz = z0 + move.z * step;
      if (isFree(nx, nz)) { p.x = nx; p.z = nz; }
      else if (isFree(nx, z0)) p.x = nx;
      else if (isFree(x0, nz)) p.z = nz;
      walked = Math.hypot(p.x - x0, p.z - z0);
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
    const s = Math.sin(phase);
    for (const [leg, side] of legs) leg.rotation.x = side * s * 0.5 * walk;
    for (const [arm, side] of arms) arm.rotation.x = -side * s * 0.6 * walk + Math.sin(time * 1.6 + side) * 0.03;
    group.rotation.set(0, heading, Math.sin(phase) * 0.05 * walk);
    group.position.y = 0.01 + Math.abs(s) * 0.022 * walk;
    parts.head.rotation.z = -s * 0.04 * walk + Math.sin(time * 0.9) * 0.025;
    parts.head.rotation.x = Math.sin(time * 1.3) * 0.015;
    // the tail waves all the time, a little more while she walks
    const wag = 1 + walk;
    parts.tail.rotation.z = Math.sin(time * 2.4) * 0.07 * wag;
    parts.tail.rotation.y = baseTailY + Math.sin(time * 2.4 + 0.6) * 0.08 * wag;
    parts.tail.rotation.x = Math.sin(time * 1.7) * 0.04 + s * 0.05 * walk;
    return walked > 0;
  }

  return { update, isFree };
}
