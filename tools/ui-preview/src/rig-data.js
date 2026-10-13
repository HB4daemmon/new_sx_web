export const frameRate = 60;
export const actionFrames = { idle: 180, attack: 45, rage: 63, artifact: 60, heal: 57, hit: 29, guard: 36 };
export const durations = Object.fromEntries(Object.entries(actionFrames).map(([name, frames]) =>
  [name, frames / frameRate * 1000]));

// Coordinates are landmarks in each cropped part, not interchangeable bounding-box centres.
export const bindings = {
  RKF01: {
    neck: [.49, .07], waist: [.52, .89], shoulders: [[.13, .36], [.89, .34]],
    head: [.51, .965], upper: [[.32, .09], [.82, .71]],
    forearm: [[.35, .09], [.55, .77]], legs: [[.80, .09], [.27, .09]],
    weapon: [.46, .80], reach: [36, 35], headWidth: 98, weaponHeight: 100, gesture: 'vajra',
  },
  RKF02: {
    neck: [.50, .09], waist: [.53, .85], shoulders: [[.12, .36], [.91, .33]],
    head: [.54, .95], upper: [[.23, .15], [.77, .91]],
    forearm: [[.74, .10], [.47, .81]], legs: [[.74, .10], [.25, .10]],
    weapon: [.57, .70], reach: [37, 34], headWidth: 102, weaponHeight: 102, gesture: 'staff',
  },
  RKF03: {
    neck: [.46, .08], waist: [.51, .88], shoulders: [[.10, .36], [.88, .32]],
    head: [.51, .91], upper: [[.22, .09], [.52, .90]],
    forearm: [[.69, .08], [.70, .81]], legs: [[.47, .07], [.49, .08]],
    weapon: [.50, .85], reach: [37, 35], headWidth: 99, weaponHeight: 118, gesture: 'staff',
  },
  RKF04: {
    neck: [.50, .08], waist: [.51, .85], shoulders: [[.10, .33], [.91, .30]],
    head: [.52, .93], upper: [[.17, .09], [.91, .59]],
    forearm: [[.48, .11], [.71, .76]], legs: [[.77, .07], [.17, .09]],
    weapon: [.27, .70], reach: [37, 33], headWidth: 103, weaponHeight: 83, gesture: 'fan',
  },
  RKF05: {
    neck: [.50, .08], waist: [.52, .82], shoulders: [[.10, .31], [.91, .28]],
    head: [.54, .95], upper: [[.12, .16], [.86, .73]],
    forearm: [[.30, .08], [.66, .65]], legs: [[.77, .08], [.20, .09]],
    weapon: [.35, .86], reach: [38, 34], headWidth: 102, weaponHeight: 116, gesture: 'sword',
  },
  'EN-A1-L1': {
    neck: [.50, .04], waist: [.59, .89], shoulders: [[.12, .39], [.90, .35]],
    head: [.66, .93], upper: [[.24, .24], [.66, .81]],
    forearm: [[.60, .12], [.43, .81]], legs: [[.72, .10], [.27, .10]],
    weapon: [.50, .86], reach: [39, 33], headWidth: 98, weaponHeight: 107, gesture: 'sword',
  },
};

const rotation = degrees => ({ skX: degrees || 0, skY: degrees || 0 });
const bone = (name, parent, x = 0, y = 0, angle = 0, length = 0) =>
  ({ name, ...(parent ? { parent } : {}), length, transform: { x, y, ...rotation(angle) } });

function limbDisplay(part, rect, landmarks, length, mirrored) {
  const [[ax, ay], [bx, by]] = landmarks;
  const dx = (bx - ax) * rect[2], dy = (by - ay) * rect[3];
  const nativeAngle = Math.atan2(dy, dx) * 180 / Math.PI;
  const scale = length / Math.hypot(dx, dy);
  return {
    name: part, type: 'image', pivot: { x: ax, y: ay },
    transform: { scX: scale, scY: mirrored ? -scale : scale,
      ...rotation(mirrored ? nativeAngle : -nativeAngle) },
  };
}

function display(part, rect, pivot, scale) {
  return { name: part, type: 'image', pivot: { x: pivot[0], y: pivot[1] },
    transform: { scX: scale, scY: scale } };
}

function authoredPose(action, amount, gesture) {
  const pose = {};
  const set = (name, degrees = 0, x = 0, y = 0) => {
    pose[name] = { x: x || 0, y: y || 0, ...rotation(degrees) };
  };
  let arm = 0, forearm = 0, tilt = 0;
  if (action === 'idle') {
    set('body', 0, 0, -amount);
    set('head', -.3 * amount);
    set('ribbon', 2 * amount);
    return pose;
  }
  if (action === 'attack' || action === 'rage') {
    const strong = action === 'rage';
    arm = (strong ? -59 : -34) * amount;
    forearm = -19 * amount;
    tilt = (gesture === 'sword' ? (strong ? 92 : 62) :
      gesture === 'fan' ? 38 : gesture === 'vajra' ? 48 : 24) * amount;
    set('body', -3 * amount, 3 * amount);
    set('backArm', 8 * amount);
    set('backHand', 12 * amount);
    set('head', 1.5 * amount);
    set('ribbon', -7 * amount);
  } else if (action === 'artifact' || action === 'heal') {
    arm = (action === 'heal' ? -18 : -35) * amount;
    forearm = (action === 'heal' ? -40 : -18) * amount;
    tilt = (action === 'heal' ? -8 : 5) * amount;
    set('backArm', (action === 'heal' ? 30 : 8) * amount);
    set('backHand', (action === 'heal' ? 32 : 8) * amount);
    set('head', 2 * amount);
    set('body', 0, 0, -amount);
  } else {
    set('body', (action === 'hit' ? 5 : 2) * amount, -3 * amount);
    set('head', -2 * amount);
    arm = -12 * amount;
    forearm = -18 * amount;
    tilt = -10 * amount;
  }
  set('frontArm', arm);
  set('frontHand', forearm);
  // The wrist rotates the weapon; its grip never translates away from the hand.
  set('weapon', tilt - arm - forearm);
  return pose;
}

function animation(name, gesture, boneNames) {
  const duration = actionFrames[name];
  const positions = name === 'idle' ? [0, 45, 90, 135, 180] :
    [0, Math.round(duration * .22), Math.round(duration * .44), Math.round(duration * .70), duration];
  const amounts = name === 'idle' ? [0, 1, 0, -1, 0] : [0, -.28, 1, .42, 0];
  const poses = amounts.map(amount => authoredPose(name, amount, gesture));
  const result = {
    name, duration, playTimes: name === 'idle' ? 0 : 1, fadeInTime: .08,
    bone: boneNames.filter(id => id !== 'root').map(id => ({
      name: id,
      frame: positions.map((position, index) => ({
        duration: index < positions.length - 1 ? positions[index + 1] - position : 0,
        tweenEasing: 0, transform: poses[index][id] || { x: 0, y: 0, skX: 0, skY: 0 },
      })),
    })),
  };
  if (name !== 'idle') {
    const impact = positions[2];
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
    ['backHand', 'backHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, true)],
    ['backArm', 'backArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, true)],
    ['frontHand', 'frontHand', limbDisplay('forearm', parts.forearm, bind.forearm, forearmLength, false)],
    ['frontArm', 'frontArm', limbDisplay('upper', parts.upper, bind.upper, upperLength, false)],
    ['body', 'body', display('torso', parts.torso, bind.waist, torsoScale)],
    ['skirt', 'skirt', display('skirt', parts.skirt, [.5, .06], Math.min(108 / parts.skirt[2], 71 / parts.skirt[3]))],
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
