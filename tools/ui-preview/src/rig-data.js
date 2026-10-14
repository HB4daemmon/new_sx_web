export const frameRate = 60;
export const actionFrames = { idle: 180, attack: 45, rage: 63, artifact: 60, heal: 57, hit: 29, guard: 36 };
export const durations = Object.fromEntries(Object.entries(actionFrames).map(([name, frames]) =>
  [name, frames / frameRate * 1000]));

// Coordinates are landmarks in each cropped part, not interchangeable bounding-box centres.
export const bindings = {
  RKF01: {
    neck: [.49, .07], waist: [.52, .86], shoulders: [[.12, .35], [.94, .33]],
    head: [.51, .965], upper: [[.32, .09], [.82, .71]],
    forearm: [[.35, .09], [.64, .82]], legs: [[.80, .09], [.27, .09]], skirt: [.50, .20],
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
    head: [.61, .91], upper: [[.22, .09], [.52, .90]],
    forearm: [[.69, .08], [.70, .84]], legs: [[.47, .07], [.49, .08]], skirt: [.50, .12],
    weapon: [.48, .81], reach: [37, 35], headWidth: 99, weaponHeight: 118, gesture: 'staff',
  },
  RKF04: {
    neck: [.50, .08], waist: [.51, .85], shoulders: [[.10, .30], [.88, .30]],
    head: [.64, .93], upper: [[.17, .09], [.91, .59]],
    forearm: [[.53, .10], [.73, .79]], legs: [[.77, .07], [.17, .09]], skirt: [.50, .13],
    weapon: [.23, .73], reach: [37, 33], headWidth: 103, weaponHeight: 83, gesture: 'fan',
  },
  RKF05: {
    neck: [.50, .08], waist: [.52, .82], shoulders: [[.09, .28], [.93, .28]],
    head: [.52, .93], upper: [[.10, .13], [.90, .72]],
    forearm: [[.30, .08], [.73, .76]], legs: [[.77, .08], [.20, .09]], skirt: [.50, .10],
    weapon: [.30, .79], reach: [38, 34], headWidth: 102, weaponHeight: 116, gesture: 'sword',
  },
  'EN-A1-L1': {
    neck: [.50, .10], waist: [.60, .94], shoulders: [[.10, .45], [.92, .34]],
    head: [.66, .93], upper: [[.33, .22], [.66, .81]],
    forearm: [[.65, .12], [.40, .82]], legs: [[.72, .10], [.27, .10]], skirt: [.57, .20],
    weapon: [.47, .80], reach: [39, 33], headWidth: 98, weaponHeight: 107, gesture: 'sword',
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

function authoredPose(action, phase, gesture) {
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
  let lean = [0, 1.4, 2.8, -4.5, -5.2, -1.2, .45, 0];
  let lift = [0, .6, 1.7, .7, 0, -.5, .2, 0];
  let counter = [0, -2, -4, 9, 12, 4, -1, 0];
  if (action === 'attack' || action === 'rage') {
    const strong = action === 'rage';
    const sword = gesture === 'sword', fan = gesture === 'fan', vajra = gesture === 'vajra';
    const windArm = sword ? (strong ? -44 : -28) : (strong ? 18 : vajra ? 14 : 10);
    const strikeArm = sword ? (strong ? -65 : -48) : fan ? (strong ? -52 : -38) :
      vajra ? (strong ? -60 : -42) : (strong ? -56 : -40);
    const strikeHand = sword ? (strong ? 32 : 22) : fan ? -14 : vajra ? (strong ? 18 : 12) : -6;
    const windWrist = sword ? (strong ? -48 : -32) : vajra ? -22 : -18;
    const strikeWrist = sword ? (strong ? 104 : 78) : fan ? (strong ? 48 : 28) :
      vajra ? (strong ? 72 : 52) : (strong ? 58 : 42);
    arms = [0, windArm * .65, windArm, strikeArm, strikeArm - 3, -14, 2, 0];
    hands = [0, -18, strong ? -58 : -44, strikeHand * .75, strikeHand, -12, -2, 0];
    wrists = [0, windWrist * .35, windWrist, strikeWrist, strikeWrist + 9, 24, -3, 0];
    if (strong) lean = lean.map(value => value * 1.25);
  } else if (action === 'artifact' || action === 'heal') {
    const heal = action === 'heal';
    arms = [0, 4, -10, heal ? -24 : -32, heal ? -25 : -34, -18, -4, 0];
    hands = [0, -12, -28, heal ? -48 : -30, heal ? -50 : -32, -26, -6, 0];
    wrists = [0, -3, -8, heal ? -12 : 4, heal ? -12 : 6, -4, -2, 0];
    lean = [0, 1, .8, -.8, -1.2, -.6, .2, 0];
    lift = [0, .4, -.2, -1.6, -1.8, -1, -.2, 0];
    counter = heal ? [0, 5, 18, 32, 34, 24, 8, 0] : [0, -2, 3, 12, 14, 8, 2, 0];
  } else {
    const hit = action === 'hit';
    arms = hit ? [0, -4, -10, -16, -12, 3, 1, 0] : [0, -14, -25, -32, -30, -18, -4, 0];
    hands = hit ? [0, -8, -15, -22, -16, -4, 1, 0] : [0, -18, -38, -50, -48, -32, -8, 0];
    wrists = hit ? [0, -4, -8, -14, -10, 4, 1, 0] : [0, -6, -14, -20, -18, -10, -2, 0];
    lean = hit ? [0, 4, 7, 9, 6, -1, -.5, 0] : [0, 1, 2, 3.2, 2.8, 1.2, .2, 0];
    lift = [0, .2, .6, 1, .6, -.3, 0, 0];
    counter = hit ? [0, -2, -4, -7, -4, 2, 1, 0] : [0, 3, 6, 10, 9, 4, 1, 0];
  }
  set('body', lean[phase], -lean[phase] * .35, lift[phase]);
  set('head', -lean[phase] * .7);
  set('backArm', counter[phase]);
  set('backHand', phase === 7 ? 0 : counter[Math.max(0, phase - 1)] * .65);
  set('skirt', [0, -.3, -.6, .4, 1.3, 1, -.3, 0][phase]);
  set('ribbon', [0, 1, 3, 1, -7, -5, 1.2, 0][phase]);
  set('frontArm', arms[phase]);
  set('frontHand', hands[phase]);
  // The wrist rotates the weapon; its grip never translates away from the hand.
  set('weapon', wrists[phase] - arms[phase] - hands[phase]);
  return pose;
}

function animation(name, gesture, boneNames) {
  const duration = actionFrames[name];
  const positions = name === 'idle' ? [0, 45, 90, 135, 180] :
    [0, .16, .29, .44, .54, .70, .86, 1].map(fraction => Math.round(duration * fraction));
  const poses = positions.map((_, index) => authoredPose(name, index, gesture));
  const result = {
    name, duration, playTimes: name === 'idle' ? 0 : 1, fadeInTime: .08,
    bone: boneNames.filter(id => id !== 'root').map(id => ({
      name: id,
      frame: positions.map((position, index) => ({
        duration: index < positions.length - 1 ? positions[index + 1] - position : 0,
        tweenEasing: name !== 'idle' && index === 2 ? -1 : 2,
        transform: poses[index][id] || { x: 0, y: 0, skX: 0, skY: 0 },
      })),
    })),
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
  const torsoScale = 92 / parts.torso[2];
  const point = ([x, y]) => [
    (x - bind.waist[0]) * parts.torso[2] * torsoScale,
    (y - bind.waist[1]) * parts.torso[3] * torsoScale,
  ];
  const [backX, backY] = point(bind.shoulders[0]);
  const [frontX, frontY] = point(bind.shoulders[1]);
  const [neckX, neckY] = point(bind.neck);
  const [upperLength, forearmLength] = bind.reach;
  const bones = [
    bone('root', null), bone('body', 'root', 0, -118),
    bone('legL', 'root', -20, -82), bone('legR', 'root', 20, -82),
    bone('backArm', 'body', backX, backY, 113, upperLength),
    bone('backHand', 'backArm', upperLength, 0, -29, forearmLength),
    bone('frontArm', 'body', frontX, frontY, 64, upperLength),
    bone('frontHand', 'frontArm', upperLength, 0, 17, forearmLength),
    bone('grip', 'frontHand', forearmLength, 0),
    bone('weapon', 'grip', 0, 0, -81),
    bone('head', 'body', neckX, neckY),
    bone('skirt', 'body', 0, -2),
    bone('ribbon', 'body', -28, 8, -5),
  ];
  const attachments = [
    ['legL', 'legL', display('legL', parts.legL, bind.legs[0], 88 / parts.legL[3])],
    ['legR', 'legR', display('legR', parts.legR, bind.legs[1], 88 / parts.legR[3])],
    ['ribbon', 'ribbon', display('ribbon', parts.ribbon, [.40, .24], .12)],
    ['backHand', 'backHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, true, torsoScale * .86)],
    ['skirt', 'skirt', display('skirt', parts.skirt, bind.skirt, Math.min(108 / parts.skirt[2], 71 / parts.skirt[3]))],
    ['body', 'body', display('torso', parts.torso, bind.waist, torsoScale)],
    ['backArm', 'backArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, true, torsoScale * .95)],
    ['frontHand', 'frontHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, false, torsoScale * .86)],
    ['frontArm', 'frontArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, false, torsoScale * .95)],
    ['head', 'head', display('head', parts.head, bind.head, bind.headWidth / parts.head[2])],
    ['weapon', 'weapon', display('weapon', parts.weapon, bind.weapon, bind.weaponHeight / parts.weapon[3])],
  ];
  return {
    name: id, type: 'Armature', frameRate,
    bone: bones,
    slot: attachments.map(([name, parent]) => ({ name, parent, displayIndex: 0 })),
    skin: [{ name: 'default', slot: attachments.map(([name, , image]) =>
      ({ name, display: [{ ...image, name: `${id}/${image.name}` }] })) }],
    animation: Object.keys(actionFrames).map(name => animation(name, bind.gesture, bones.map(item => item.name))),
  };
}

export function createSkeletonData(library) {
  return { name: 'suishi', version: '5.5', compatibleVersion: '5.5', frameRate,
    armature: Object.entries(library.rigs).map(([id, rig]) => createArmature(id, rig)) };
}

export function createTextureData(id, rig) {
  return {
    name: id, imagePath: rig.src, width: 768, height: 768,
    SubTexture: Object.entries(rig.parts).map(([part, [x, y, width, height]]) =>
      ({ name: `${id}/${part}`, x, y, width, height })),
  };
}
