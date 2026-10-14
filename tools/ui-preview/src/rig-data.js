export const frameRate = 60;
export const actionFrames = { idle: 180, attack: 45, rage: 63, artifact: 60, heal: 57, hit: 29, guard: 36 };
export const durations = Object.fromEntries(Object.entries(actionFrames).map(([name, frames]) =>
  [name, frames / frameRate * 1000]));

// Coordinates are landmarks in each cropped part, not interchangeable bounding-box centres.
export const bindings = {
  RKF01: {
    neck: [.49, .07], waist: [.52, .86], shoulders: [[.12, .35], [.94, .33]],
    head: [.51, .965], upper: [[.32, .09], [.77, .648]],
    forearm: [[.366, .13], [.64, .82]], legs: [[.80, .09], [.27, .09]], skirt: [.50, .20],
    weapon: [.46, .74], reach: [36, 35], headWidth: 98, weaponHeight: 100, gesture: 'vajra',
  },
  RKF02: {
    neck: [.50, .09], waist: [.53, .85], shoulders: [[.12, .36], [.94, .35]],
    head: [.58, .965], upper: [[.20, .18], [.77, .91]],
    forearm: [[.74, .10], [.46, .83]], legs: [[.74, .10], [.25, .10]], skirt: [.50, .16],
    weapon: [.56, .64], reach: [37, 34], headWidth: 102, weaponHeight: 102, gesture: 'staff',
  },
  RKF03: {
    neck: [.46, .08], waist: [.51, .88], shoulders: [[.075, .36], [.865, .30]],
    head: [.61, .91], upper: [[.22, .09], [.49, .819]],
    forearm: [[.69, .13], [.70, .84]], legs: [[.47, .07], [.49, .08]], skirt: [.50, .12],
    weapon: [.48, .81], reach: [37, 35], headWidth: 99, weaponHeight: 118, gesture: 'staff',
  },
  RKF04: {
    neck: [.50, .08], waist: [.51, .85], shoulders: [[.10, .30], [.88, .30]],
    head: [.64, .93], upper: [[.17, .09], [.91, .59]],
    forearm: [[.53, .10], [.73, .79]], legs: [[.77, .07], [.17, .09]], skirt: [.50, .13],
    weapon: [.23, .73], reach: [37, 33], headWidth: 103, weaponHeight: 83, gesture: 'fan',
  },
  RKF05: {
    layered: true, neck: [.52, .075], waist: [.52, .94], shoulders: [[.09, .28], [.94, .28]],
    head: [.57, .97], upper: { back: [[.25, .13], [.67, .86]], front: [[.76, .13], [.35, .83]] },
    forearm: { back: [[.17, .10], [.81, .89]], front: [[.17, .11], [.65, .79]] },
    hand: [[.13, .48], [.64, .51]], handLength: 14,
    legs: [[.64, .09], [.30, .09]], skirt: [.51, .12],
    weapon: [.50, .88], reach: [36, 34], headWidth: 115, weaponHeight: 116, gesture: 'sword',
    sleeveWidth: [.62, .60],
  },
  'EN-A1-L1': {
    layered: true, neck: [.54, .075], waist: [.58, .91], shoulders: [[.18, .28], [.91, .27]],
    head: [.55, .97], upper: { back: [[.42, .16], [.64, .86]], front: [[.54, .14], [.45, .86]] },
    forearm: { back: [[.21, .12], [.81, .83]], front: [[.35, .14], [.66, .82]] },
    hand: [[.14, .48], [.64, .51]], handLength: 16,
    legs: [[.72, .10], [.34, .10]], skirt: [.52, .10],
    weapon: [.50, .88], reach: [39, 33], headWidth: 108, weaponHeight: 107, gesture: 'sword',
    torsoWidth: 104, sleeveWidth: [.73, .73],
  },
};

const rotation = degrees => ({ skX: degrees || 0, skY: degrees || 0 });
const bone = (name, parent, x = 0, y = 0, angle = 0, length = 0) =>
  ({ name, ...(parent ? { parent } : {}), length, transform: { x, y, ...rotation(angle) } });

function limbDisplay(part, rect, landmarks, length, mirrored, widthScale) {
  const [[ax, ay], [bx, by]] = landmarks;
  const dx = (bx - ax) * rect[2], dy = (by - ay) * rect[3];
  const nativeLength = Math.hypot(dx, dy);
  const cos = dx / nativeLength, sin = dy / nativeLength;
  const along = length / nativeLength, across = widthScale * (mirrored ? -1 : 1);
  // Compress along the limb, not across the socket. Both landmarks stay on the bone axis.
  const a = along * cos, b = -across * sin, c = along * sin, d = across * cos;
  return {
    name: part, type: 'image', pivot: { x: ax, y: ay },
    transform: { scX: Math.hypot(a, b), scY: Math.hypot(c, d),
      skX: Math.atan2(-c, d) * 180 / Math.PI, skY: Math.atan2(b, a) * 180 / Math.PI },
  };
}

function display(part, rect, pivot, scale) {
  return { name: part, type: 'image', pivot: { x: pivot[0], y: pivot[1] },
    transform: { scX: scale, scY: scale } };
}

function authoredPose(action, phase, gesture, layered) {
  const pose = {};
  const set = (name, degrees = 0, x = 0, y = 0) => {
    pose[name] = { x: x || 0, y: y || 0, ...rotation(degrees) };
  };
  if (action === 'idle') {
    const breath = [0, 1, 0, -1, 0][phase];
    set('body', .25 * breath, 0, -.9 * breath);
    set('head', -.55 * breath);
    set('frontArm', -.8 * breath);
    set('frontHand', .9 * breath);
    set('backArm', .6 * breath);
    set('ribbon', [0, 1.3, 1, -1.3, 0][phase]);
    return pose;
  }
  let arms, hands, wrists;
  let lean = [0, -2, -4.5, 7.5, 9, 2.5, -.6, 0];
  let lift = [0, .4, 1, .6, 1.2, -.4, .1, 0];
  let shift = [0, -1, -2.5, 2, 3, .8, -.3, 0];
  let counter = [0, 4, 10, -15, -22, -8, 2, 0];
  if (action === 'attack' || action === 'rage') {
    const strong = action === 'rage';
    const sword = gesture === 'sword', fan = gesture === 'fan', vajra = gesture === 'vajra';
    if (sword) {
      arms = strong ? [0, -12, -62, -24, -10, 5, 2, 0] : [0, -8, -50, -20, -5, 7, 2, 0];
      hands = strong ? [0, -8, -20, 56, 60, 25, -5, 0] : [0, -6, -14, 50, 58, 20, -5, 0];
      wrists = strong ? [0, 10, 24, 26, 32, 12, -3, 0] : [0, 8, 20, 20, 25, 10, -3, 0];
    } else {
      const wind = vajra ? 16 : fan ? 8 : 12;
      const strike = fan ? -40 : -32;
      const extension = vajra ? 44 : fan ? 40 : 38;
      arms = [0, wind * .5, wind, strike, strike + 18, -6, 2, 0];
      hands = [0, -10, -24, extension, 48, 18, -4, 0];
      wrists = [0, -4, -12, fan ? 22 : 18, fan ? 28 : 24, 8, -2, 0];
      if (strong) {
        arms[2] += 8;
        arms[3] -= 6;
        wrists[3] += 6;
        wrists[4] += 6;
      }
    }
    if (strong) {
      lean = lean.map(value => value * 1.2);
      shift = shift.map(value => value * 1.2);
    }
  } else if (action === 'artifact' || action === 'heal') {
    const heal = action === 'heal';
    arms = [0, -6, -14, heal ? -26 : -32, heal ? -28 : -34, -20, -5, 0];
    hands = [0, -4, -8, heal ? 14 : 20, heal ? 18 : 24, 12, -2, 0];
    wrists = [0, 2, 4, heal ? 8 : 16, heal ? 10 : 18, 4, -1, 0];
    lean = [0, -.5, -1, 1.2, 1.6, .8, -.2, 0];
    lift = [0, .2, -.4, -1.2, -1.4, -.8, -.2, 0];
    shift = [0, 0, -.3, .4, .6, .2, 0, 0];
    counter = heal ? [0, -8, -24, -45, -48, -28, -8, 0] : [0, 3, -4, -18, -22, -12, -3, 0];
  } else {
    const hit = action === 'hit';
    arms = hit ? [0, -4, -10, -16, -12, 3, 1, 0] : [0, -12, -22, -30, -26, -16, -4, 0];
    hands = hit ? [0, -4, -10, -14, -10, -3, 1, 0] : [0, -6, -18, -22, -20, -12, -3, 0];
    wrists = hit ? [0, 2, 4, 6, 4, -2, -1, 0] : [0, 4, 12, 20, 18, 10, 2, 0];
    lean = hit ? [0, -3, -6, -8, -5, 1, .4, 0] : [0, .5, 1.5, 3, 2.4, 1, .2, 0];
    lift = [0, .2, .6, 1, .6, -.3, 0, 0];
    shift = hit ? [0, -1, -2, -3, -2, .4, 0, 0] : [0, 0, .3, .5, .4, .2, 0, 0];
    counter = hit ? [0, 2, 4, 7, 4, -2, -1, 0] : [0, -3, -8, -16, -14, -6, -1, 0];
  }
  set('body', lean[phase], shift[phase], lift[phase]);
  set('head', -lean[phase] * .55);
  set('backArm', counter[phase]);
  set('backHand', phase === 7 ? 0 : counter[phase === 6 ? 6 : Math.max(0, phase - 1)] * .65);
  set('skirt', [0, -.3, -.6, .4, 1.3, 1, -.3, 0][phase]);
  set('ribbon', [0, 1, 3, 1, -7, -5, 1.2, 0][phase]);
  set('frontArm', arms[phase]);
  set('frontHand', hands[phase]);
  // The shoulder and elbow drive the stroke; the wrist adds only a small follow-through.
  set(layered ? 'wrist' : 'weapon', wrists[phase]);
  return pose;
}

const actionPhases = {
  body: [0, .10, .24, .44, .57, .73, .90, 1],
  head: [0, .14, .28, .46, .60, .77, .92, 1],
  frontArm: [0, .12, .29, .42, .54, .70, .88, 1],
  frontHand: [0, .18, .31, .44, .57, .75, .90, 1],
  wrist: [0, .20, .32, .44, .59, .76, .92, 1],
  weapon: [0, .20, .32, .44, .59, .76, .92, 1],
  backArm: [0, .18, .32, .47, .62, .77, .92, 1],
  backHand: [0, .20, .34, .49, .64, .79, .94, 1],
  skirt: [0, .18, .34, .51, .63, .80, .94, 1],
  ribbon: [0, .21, .36, .54, .66, .82, .94, 1],
};

function smoothTrack(times, values) {
  const slopes = values.slice(1).map((value, index) =>
    (value - values[index]) / (times[index + 1] - times[index]));
  const tangents = values.map((_, index) => {
    if (!index || index === values.length - 1 || slopes[index - 1] * slopes[index] <= 0) return 0;
    const before = times[index] - times[index - 1], after = times[index + 1] - times[index];
    const first = 2 * after + before, second = after + 2 * before;
    return (first + second) / (first / slopes[index - 1] + second / slopes[index]);
  });
  return time => {
    const index = Math.max(0, times.findIndex(end => end >= time) - 1);
    const span = times[index + 1] - times[index], t = (time - times[index]) / span;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * values[index] +
      (t3 - 2 * t2 + t) * span * tangents[index] +
      (-2 * t3 + 3 * t2) * values[index + 1] +
      (t3 - t2) * span * tangents[index + 1];
  };
}

function animation(name, gesture, boneNames, layered) {
  const duration = actionFrames[name];
  const positions = name === 'idle' ? [0, 45, 90, 135, 180] :
    [0, .16, .29, .44, .54, .70, .86, 1].map(fraction => Math.round(duration * fraction));
  const poses = positions.map((_, index) => authoredPose(name, index, gesture, layered));
  const result = {
    name, duration, playTimes: name === 'idle' ? 0 : 1, fadeInTime: .08,
    bone: boneNames.filter(id => id !== 'root').map(id => {
      const zero = { x: 0, y: 0, skX: 0, skY: 0 };
      if (name === 'idle') return {
        name: id,
        frame: positions.map((position, index) => ({
          duration: index < positions.length - 1 ? positions[index + 1] - position : 0,
          tweenEasing: 2, transform: poses[index][id] || zero,
        })),
      };
      const times = (actionPhases[id] || [0, .16, .29, .44, .54, .70, .86, 1])
        .map(fraction => Math.round(duration * fraction));
      const tracks = Object.fromEntries(Object.keys(zero).map(key => [key,
        smoothTrack(times, poses.map(pose => (pose[id] || zero)[key]))]));
      // Bake smooth, staggered authoring curves. DragonBones still owns all playback and transforms.
      return {
        name: id,
        frame: Array.from({ length: duration + 1 }, (_, frame) => ({
          duration: frame < duration ? 1 : 0, tweenEasing: 0,
          transform: frame === duration ? zero : Object.fromEntries(
            Object.entries(tracks).map(([key, sample]) => [key, sample(frame)])),
        })),
      };
    }),
  };
  if (name !== 'idle') {
    const impact = Math.round(duration * .44);
    result.frame = [{ duration: impact }, { duration: duration - impact, event: 'impact' }];
  }
  return result;
}

export function createArmature(id, rig) {
  const bind = bindings[id], parts = rig.parts;
  if (!bind || !parts) throw new Error(`Missing binding: ${id}`);
  const layered = rig.layout === 'layered-v2';
  if (layered !== Boolean(bind.layered)) throw new Error(`Artwork does not match binding: ${id}`);
  const torsoScale = (bind.torsoWidth || 92) / parts.torso[2];
  const point = ([x, y]) => [
    (x - bind.waist[0]) * parts.torso[2] * torsoScale,
    (y - bind.waist[1]) * parts.torso[3] * torsoScale,
  ];
  const [backX, backY] = point(bind.shoulders[0]);
  const [frontX, frontY] = point(bind.shoulders[1]);
  const [neckX, neckY] = point(bind.neck);
  const [upperLength, forearmLength] = bind.reach;
  const frontAngle = 70, elbowAngle = layered ? -66 : -54;
  const wristAngle = -frontAngle - elbowAngle;
  const bones = [
    bone('root', null), bone('body', 'root', 0, -118),
    bone('legL', 'root', -20, -82), bone('legR', 'root', 20, -82),
    bone('backArm', 'body', backX, backY, 113, upperLength),
    bone('backHand', 'backArm', upperLength, 0, -29, forearmLength),
    bone('frontArm', 'body', frontX, frontY, frontAngle, upperLength),
    bone('frontHand', 'frontArm', upperLength, 0, elbowAngle, forearmLength),
    ...(layered ? [
      bone('wrist', 'frontHand', forearmLength, 0, wristAngle, bind.handLength),
      bone('grip', 'wrist', bind.handLength, 0),
    ] : [bone('grip', 'frontHand', forearmLength, 0)]),
    bone('weapon', 'grip', 0, 0, layered ? 0 : wristAngle),
    bone('head', 'body', neckX, neckY),
    bone('skirt', 'body', 0, -2),
    bone('ribbon', 'body', -28, 8, -5),
  ];
  const upperScale = torsoScale * (layered ? bind.sleeveWidth[0] : .95);
  const forearmScale = torsoScale * (layered ? bind.sleeveWidth[1] : .86);
  const attachments = [
    ['legL', 'legL', display('legL', parts.legL, bind.legs[0], 88 / parts.legL[3])],
    ['legR', 'legR', display('legR', parts.legR, bind.legs[1], 88 / parts.legR[3])],
    ['ribbon', 'ribbon', display('ribbon', parts.ribbon, [.40, .24], .12)],
    ...(layered ? [
      ['backArm', 'backArm', limbDisplay('backUpper', parts.backUpper, bind.upper.back, upperLength, false, upperScale)],
      ['backHand', 'backHand', limbDisplay('backForearm', parts.backForearm, bind.forearm.back, forearmLength, false, forearmScale)],
    ] : [
      ['backHand', 'backHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, true, forearmScale)],
    ]),
    ['skirt', 'skirt', display('skirt', parts.skirt, bind.skirt, Math.min(108 / parts.skirt[2], 71 / parts.skirt[3]))],
    ['body', 'body', display('torso', parts.torso, bind.waist, torsoScale)],
    ...(layered ? [
      ['frontArm', 'frontArm', limbDisplay('frontUpper', parts.frontUpper, bind.upper.front, upperLength, false, upperScale)],
      ['frontHand', 'frontHand', limbDisplay('frontForearm', parts.frontForearm, bind.forearm.front, forearmLength, false, forearmScale)],
    ] : [
      ['backArm', 'backArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, true, upperScale)],
      ['frontHand', 'frontHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, false, forearmScale)],
      ['frontArm', 'frontArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, false, upperScale)],
    ]),
    ['head', 'head', display('head', parts.head, bind.head, bind.headWidth / parts.head[2])],
    ['weapon', 'weapon', display('weapon', parts.weapon, bind.weapon, bind.weaponHeight / parts.weapon[3])],
  ];
  if (layered) {
    const [[wx, wy], [gx, gy]] = bind.hand;
    const handScale = bind.handLength /
      Math.hypot((gx - wx) * parts.handGrip[2], (gy - wy) * parts.handGrip[3]);
    attachments.push(['palm', 'wrist',
      limbDisplay('handGrip', parts.handGrip, bind.hand, bind.handLength, false, handScale)]);
  }
  return {
    name: id, type: 'Armature', frameRate,
    bone: bones,
    slot: attachments.map(([name, parent]) => ({ name, parent, displayIndex: 0 })),
    skin: [{ name: 'default', slot: attachments.map(([name, , image]) =>
      ({ name, display: [{ ...image, name: `${id}/${image.name}` }] })) }],
    animation: Object.keys(actionFrames).map(name =>
      animation(name, bind.gesture, bones.map(item => item.name), layered)),
  };
}

export function createSkeletonData(library) {
  return { name: 'suishi', version: '5.5', compatibleVersion: '5.5', frameRate,
    armature: Object.entries(library.rigs).map(([id, rig]) => createArmature(id, rig)) };
}

export function createTextureData(id, rig) {
  return {
    name: id, imagePath: rig.src, width: rig.dimensions?.[0] || 768, height: rig.dimensions?.[1] || 768,
    SubTexture: Object.entries(rig.parts).map(([part, [x, y, width, height]]) =>
      ({ name: `${id}/${part}`, x, y, width, height })),
  };
}
