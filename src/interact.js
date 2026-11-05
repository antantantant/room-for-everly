// The squirrel using things: picking them up, putting them down, opening and switching.
//
// Every frame the nearest thing within her reach (and not behind her) is outlined
// and named in a label; Space uses it. Small things are carried in front of her,
// big ones (chairs, plants, the pouf) over her head. Space again puts what she is
// carrying down in front of her: on a table or counter if there is a flat top
// there, otherwise on the floor.
import * as THREE from 'three';

const HOLD_FRONT = new THREE.Vector3(0, 0.3, 0.2);   // hands, held out in front
const HOLD_OVER = 0.97;                               // just above the tips of her ears
const BIG = { tall: 0.45, wide: 0.55 };               // bigger than this goes over her head

export function createInteraction({ room, squirrel, walker, scene, camera, pipeline, feelings, hint }) {
  const holder = new THREE.Group();
  squirrel.group.add(holder);
  const items = room.interactables;
  const boxes = new Map();
  let current = null, held = null, carry = null, outlined = null;
  const tweens = [];

  // world-space bounds of the parts she must get close to, kept until the thing moves
  const partsOf = it => {
    let list = boxes.get(it);
    const moving = it.kind === 'switch' && it.k !== (it.on ? 1 : 0);
    if (!list || it.dirty || moving) {
      list = (it.near || [it.obj]).map(o => new THREE.Box3().setFromObject(o));
      boxes.set(it, list);
      it.dirty = false;
    }
    return list;
  };
  const boundsOf = it => partsOf(it).reduce((all, b) => all.union(b), new THREE.Box3());

  // bounds of a thing in its own space, turned by `q` and at its own scale
  const localBounds = (obj, q) => {
    obj.updateWorldMatrix(true, true);
    const inv = obj.matrixWorld.clone().invert();
    const turn = new THREE.Matrix4().compose(new THREE.Vector3(), q, obj.scale);
    const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse(o => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); part.copy(o.boundingBox); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); part.copy(o.geometry.boundingBox); }
      box.union(part.applyMatrix4(m.multiplyMatrices(turn, inv).multiply(o.matrixWorld)));
    });
    return box;
  };

  // glide `obj` to a position and turn in its parent's space
  function glide(obj, toP, toQ, seconds, done) {
    tweens.push({ obj, fromP: obj.position.clone(), fromQ: obj.quaternion.clone(), toP, toQ, t: 0, seconds, done });
  }

  const upright = it => it.lay ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...it.lay)) : new THREE.Quaternion();

  function pickUp(it) {
    held = it;
    const obj = it.obj, q = upright(it), box = localBounds(obj, q), size = box.getSize(new THREE.Vector3());
    carry = !it.lay && (size.y > BIG.tall || Math.max(size.x, size.z) > BIG.wide) ? 'over' : 'front';
    holder.attach(obj);
    const c = box.getCenter(new THREE.Vector3());
    const to = carry === 'over'
      ? new THREE.Vector3(-c.x, HOLD_OVER - box.min.y, -c.z)
      : new THREE.Vector3(HOLD_FRONT.x - c.x, HOLD_FRONT.y - box.min.y, HOLD_FRONT.z - box.min.z);
    glide(obj, to, q, 0.35);
    feelings.event('pick');
    walker.refresh();
  }

  function putDown() {
    const it = held, obj = it.obj, q = upright(it), box = localBounds(obj, q);
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    const p = squirrel.group.position, h = walker.heading, fx = Math.sin(h), fz = Math.cos(h);
    // in front of her: on a flat top if there is one there, otherwise on the floor
    let spot = null;
    for (const d of [0.24 + r, 0.32 + r * 1.2, 0.2 + r * 0.7]) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const under = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => walker.heightAt(x + a * r * 0.7, z + b * r * 0.7));
      const lo = Math.min(...under), hi = Math.max(...under);
      if (hi - lo < 0.035 && hi < 0.95) { spot = new THREE.Vector3(x, hi, z); break; }
    }
    spot ||= new THREE.Vector3(p.x + fx * (0.24 + r), 0.012, p.z + fz * (0.24 + r));
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h);
    const to = spot.clone().sub(new THREE.Vector3(c.x, box.min.y, c.z).applyQuaternion(yaw));
    scene.attach(obj);
    held = null;
    carry = null;
    glide(obj, to, yaw.multiply(q), 0.35, () => { it.dirty = true; walker.refresh(); });
    if (it.plush) feelings.event('plush-down');
  }

  function use(it) {
    it.on = !it.on;
    const light = it.verbs[0] === 'turn on';
    if (it.name === 'TV' && !it.on) feelings.event('tv-off');
    else if (it.on && (light || it.name === 'fridge')) feelings.event('on');
    else feelings.event('use');
  }

  addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault();
    if (held) { if (!tweens.length) putDown(); }
    else if (current) current.kind === 'pick' ? pickUp(current) : use(current);
  });

  // Everything she could use from where she stands, best first: within reach of
  // her middle and not behind her, the closest and most in front of her first.
  function candidates() {
    const p = squirrel.group.position, h = walker.heading, fx = Math.sin(h), fz = Math.cos(h), list = [];
    for (const it of items) {
      if (it === held || (it.inside && it.inside.k < 0.8)) continue;
      let best = null;
      for (const b of partsOf(it)) {
        if (b.min.y > 1.9) continue;
        const dx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x) - p.x, dz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z) - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.2 + (it.reach ?? 0.35)) continue;
        const facing = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
        if (facing < -0.2) continue;
        const score = d - 0.2 * facing;
        if (best === null || score < best) best = score;
      }
      if (best !== null) list.push({ it, score: best });
    }
    return list.sort((a, b) => a.score - b.score);
  }
  const nearest = () => candidates()[0]?.it || null;

  const at = new THREE.Vector3();
  function label(text, x, y, z) {
    at.set(x, y, z).project(camera);
    if (!text || at.z > 1) { hint.hidden = true; return; }
    hint.hidden = false;
    hint.textContent = text;
    // above the thing, but always on screen
    hint.style.left = `${THREE.MathUtils.clamp((at.x * 0.5 + 0.5) * innerWidth, 120, innerWidth - 120)}px`;
    hint.style.top = `${THREE.MathUtils.clamp((-at.y * 0.5 + 0.5) * innerHeight, 150, innerHeight - 60)}px`;
  }

  function update(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t = Math.min(1, tw.t + dt / tw.seconds);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      tw.obj.position.lerpVectors(tw.fromP, tw.toP, k);
      tw.obj.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, k);
      if (tw.t === 1) { tweens.splice(i, 1); tw.done?.(); }
    }
    current = held ? null : nearest();
    const show = current && current.obj;
    if (show !== outlined) { outlined = show; pipeline.setOutline(show ? [show] : []); }
    if (held) {
      const p = squirrel.group.position;
      label(`Space · put down the ${held.name}`, p.x, carry === 'over' ? 1.75 : 1.15, p.z);
    } else if (current) {
      const b = boundsOf(current), c = b.getCenter(new THREE.Vector3());
      const verb = current.kind === 'pick' ? 'pick up' : current.verbs[current.on ? 1 : 0];
      label(`Space · ${verb} the ${current.name}`, c.x, Math.min(b.max.y, 1.9) + 0.12, c.z);
    } else label(null);
  }

  return {
    update, get carry() { return carry; }, get current() { return current; },
    // console helper: what she could reach right now, and how close each is
    candidates: () => candidates().map(({ it, score }) => `${it.name} ${score.toFixed(2)}`),
  };
}
