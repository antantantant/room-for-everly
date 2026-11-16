// How the squirrel feels, and why.
//
// She is happy when she picks something up or switches something on, sad when she
// puts a plush down or the TV goes off, and cross when she keeps walking into
// things. Left alone she gets bored, then sleepy; the next key press wakes her.
// A feeling set by hand (the buttons, or keys 1 to 5) lasts a little longer.
//
// She also has energy, from 0 (worn out) to 1. Playing costs it (bouncing and
// dancing most), walking a little; sleeping fills it up again and snacks help.
// Low on energy she gets sleepy, and too tired to play until she has had a nap.
export function createFeelings(squirrel, onChange) {
  let mood = 'neutral', timer = 0, idle = 0, bump = 0, blinkIn = 3, blink = 0, shown = '', energy = 1;

  function show() {
    const face = mood === 'neutral' && blink > 0 ? 'blink' : mood;
    if (face !== shown) { squirrel.setFace(face); shown = face; }
  }
  function set(name, seconds = 12) {
    const changed = name !== mood;
    mood = name;
    timer = seconds;
    show();
    if (changed) onChange?.(mood);
  }
  const BECAUSE = {
    pick: ['happy', 4],          // she has got something
    on: ['happy', 3],            // the TV, a lamp, the fridge
    'plush-down': ['sad', 5],    // she misses her friend
    'tv-off': ['sad', 3],
  };
  function event(kind) {
    idle = 0;
    const why = BECAUSE[kind];
    if (why) set(...why);
  }

  // costs energy (negative restores it); worn down, she feels sleepy
  function spend(amount) {
    energy = Math.min(1, Math.max(0, energy - amount));
    if (energy < 0.25 && amount > 0) set('sleepy', 8);
  }

  // input: a walking key is held; bumped: she walked into something this frame
  function update(dt, { input, bumped, walked }) {
    if (walked) energy = Math.max(0, energy - dt * 0.004);
    if (input) {
      idle = 0;
      if (mood === 'bored' || (mood === 'sleepy' && energy >= 0.25)) set('neutral', 0);   // worn out, walking about does not wake her up
    } else idle += dt;
    if (idle > 45 && mood !== 'sleepy') set('sleepy', Infinity);
    else if (idle > 20 && mood === 'neutral') set('bored', Infinity);

    bump = bumped ? bump + dt : Math.max(0, bump - dt * 0.5);
    if (bump > 1.2) { set('angry', 4); bump = 0; }

    if (timer !== Infinity && mood !== 'neutral') {
      timer -= dt;
      if (timer <= 0) set('neutral', 0);
    }

    // she blinks now and then
    blink -= dt;
    blinkIn -= dt;
    if (blinkIn <= 0) { blink = 0.14; blinkIn = 2.5 + Math.random() * 3; }
    show();
  }

  return { get mood() { return mood; }, get energy() { return energy; }, set, event, update, spend };
}
