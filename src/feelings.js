// How the squirrel feels, and why.
//
// She is happy when she picks something up or switches something on, sad when she
// puts a plush down or the TV goes off, and cross when she keeps walking into
// things. Left alone she gets bored, then sleepy; the next key press wakes her.
// A feeling set by hand (the buttons, or keys 1 to 5) lasts a little longer.
export function createFeelings(squirrel, onChange) {
  let mood = 'neutral', timer = 0, idle = 0, bump = 0, blinkIn = 3, blink = 0, shown = '';

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

  // input: a walking key is held; bumped: she walked into something this frame
  function update(dt, { input, bumped }) {
    if (input) {
      idle = 0;
      if (mood === 'bored' || mood === 'sleepy') set('neutral', 0);
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

  return { get mood() { return mood; }, set, event, update };
}
