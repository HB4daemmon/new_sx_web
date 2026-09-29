/** Procedural native SVG artwork for the Shanhai runtime. */
let artSerial = 0;

export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

function nextArtId(prefix: string): string {
  artSerial += 1;
  return `shanhai-${prefix}-${artSerial}`;
}

const iconPaths: Record<string, string> = {
  sword: '<path d="M48 8 55 16 27 49 17 39Z"/><path d="m16 35 15 14M23 44 11 58m-3-5 8 8"/>',
  swords: '<path d="m11 8 7 1 30 38-5 5L12 15ZM53 8l-7 1L16 47l5 5 31-37ZM9 43l15 14M40 57l15-14M16 51l-5 9m36-9 6 9"/>',
  spear: '<path d="M49 5 58 7 57 16 40 26l-4-4ZM39 23 10 58m20-32 12 12"/>',
  flame: '<path d="M35 5c2 16-20 17-19 33 0 12 9 20 19 20s19-7 17-18c-1-7-5-11-8-16 0 9-5 12-7 9C31 28 42 15 35 5Z"/><path d="M33 34c2 9-8 9-5 17s14 5 14-2c0-6-7-7-9-15Z"/>',
  shield: '<path d="m32 6 22 8v19c0 13-22 25-22 25S10 46 10 33V14Z"/><path d="m32 15 13 6v11c0 7-13 16-13 16S19 39 19 32V21Zm0 7v15m-7-7h14"/>',
  mirror: '<circle cx="32" cy="29" r="22"/><circle cx="32" cy="29" r="15"/><path d="M26 51v8h12v-8M20 21l9-5m-12 13 13-9m2 31V9"/>',
  fist: '<path d="M15 36V19c0-5 8-5 8 0v12-18c0-5 8-5 8 0v17-18c0-5 8-5 8 0v19-15c0-5 8-5 8 0v22l-8 11v10H22V46l-8-10c-6-10 0-15 5-7l7 9"/>',
  bolt: '<path d="M37 4 13 37h17l-3 24 25-36H35Z"/>',
  lotus: '<path d="M32 55C8 50 6 34 8 26c15 2 23 12 24 29Zm0 0c24-5 26-21 24-29-15 2-23 12-24 29Zm0-1c-18-17-15-28 0-45 15 17 18 28 0 45Z"/>',
  sun: '<circle cx="32" cy="32" r="14"/><circle cx="32" cy="32" r="6"/><path d="M32 3v10m0 38v10M3 32h10m38 0h10M11 11l8 8m26 26 8 8M11 53l8-8m26-26 8-8"/>',
  moon: '<path d="M44 9C21 3 6 27 19 47c9 14 31 14 40-1-22 7-41-16-15-37Z"/><path d="m47 13 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/>',
  eye: '<path d="M4 32s11-18 28-18 28 18 28 18-11 18-28 18S4 32 4 32Z"/><circle cx="32" cy="32" r="11"/><path d="M32 22v20M25 6l7 5 7-5m-14 52 7-5 7 5"/>',
  mountain: '<path d="m4 51 19-33 10 17L45 9l16 42ZM15 39l9-4 7 8m6-13 8-9 8 15M6 57h52"/>',
  cloud: '<path d="M8 43c-12-15 8-25 15-16-2-20 28-19 27 0 16-1 18 20 0 20H25c-15 0-14-15-3-15 6 0 7 8 1 8M6 55h38m7 0h6"/>',
  wave: '<path d="M4 33c11-25 27-28 28-11 0 12-18 18-8 26 5 5 19 4 22-7 8 1 11 6 14 11M4 45c9 13 16 13 25 9m-19 5h48M35 12c15-6 24 4 22 17-1 7-10 12-16 9"/>',
  pearl: '<circle cx="32" cy="30" r="19"/><circle cx="27" cy="24" r="6"/><path d="M15 42 7 57l25-7 25 7-8-15M32 6V2M6 30H2m56 0h4"/>',
  bell: '<path d="M13 45h38l-5-8V25c0-20-28-20-28 0v12ZM9 45v6h46v-6M26 51c0 10 12 10 12 0M27 10V5h10v5"/>',
  flag: '<path d="M15 59V5m1 3h34l-9 12 10 14H17M11 59h15m-2-40 10 7 8-13"/>',
  jade: '<path d="m32 8 16 10 2 22-18 16-18-16 2-22Z"/><circle cx="32" cy="26" r="8"/><path d="M32 5v10m-6 41-3 7m15-7 3 7M20 40l12 9 12-9"/>',
  feather: '<path d="M13 59c5-25 15-47 42-53 6 24-7 44-34 43M19 48 48 16M28 35l-5-12m13 1-3-9M28 36l18-1M20 47l18-1"/>',
  lamp: '<path d="M19 11h26l4 33H15ZM26 44v11m12-11v11M17 58h30M32 8V3m-9 5h18M32 17c-8 9-9 16 0 19 9-3 8-10 0-19Z"/>',
  coin: '<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="19"/><path d="M25 25h14v14H25ZM32 15v5m0 24v5M15 32h5m24 0h5"/>',
  gourd: '<path d="M26 9c-9 6-8 14-1 19-20 8-18 30 7 30s27-22 7-30c7-5 8-13-1-19ZM24 7h16m-8-1V2M22 31l20 3m-20 4 20-3"/>',
  ring: '<ellipse cx="32" cy="32" rx="23" ry="25"/><ellipse cx="32" cy="32" rx="14" ry="16"/><path d="m16 14 7 7m18 22 7 7M16 50l7-7m18-22 7-7M28 7h8m-8 50h8"/>',
  seal: '<path d="M12 33h40v21H12ZM18 28h28l-3-10-9-5-10 4ZM8 54h48v5H8ZM19 38h26m-20 0v11m14-11v11m-20 0h26M26 11l8-7 8 6"/>',
  orbs: '<circle cx="32" cy="12" r="7"/><circle cx="50" cy="24" r="7"/><circle cx="44" cy="48" r="7"/><circle cx="20" cy="48" r="7"/><circle cx="13" cy="24" r="7"/><path d="M24 13 18 18m21-5 7 5m7 13-5 10m-27 14h14M10 31l7 10"/>',
  book: '<path d="M32 16C23 8 12 9 5 11v41c10-3 18-2 27 4 9-6 17-7 27-4V11c-7-2-18-3-27 5Zm0 0v40M12 21l12 3m-12 9 12 3m16-12 12-3m-12 15 12-3"/>',
  tree: '<path d="M32 7 17 25h9L12 43h15v14h10V43h15L38 25h9L32 7Zm-9 50h18M32 43v14"/>',
  archive: '<path d="M8 17h48v40H8zM5 7h54v10H5zM24 28h16v7H24zM22 44h20"/>',
  restart: '<path d="M52 24A22 22 0 0 0 14 15L8 22m0 0V9m0 13h13M12 40a22 22 0 0 0 38 9l6-7m0 0v13m0-13H43"/>',
  gate: '<path d="M7 21h50L32 6ZM12 26h40M16 27v31m32-31v31M9 59h46M24 59V37h16v22M3 20h58"/>',
  camp: '<path d="m32 8 25 48H7Zm0 22 11 26H21ZM4 60h56m-20-44 8-5m-28 5-8-5"/>',
  diamond: '<path d="m32 5 23 27-23 27L9 32Zm0 0v54M9 32h46"/>',
  skull: '<path d="M18 46C-2 27 11 5 32 5s34 22 14 41v12H18ZM23 58V48m9 10V47m9 11V48"/><circle cx="22" cy="29" r="6"/><circle cx="42" cy="29" r="6"/><path d="m29 41 3-5 3 5"/>',
  gear: '<path d="m26 5 12 0 3 8 8 3 8-1 5 11-6 7-1 8 3 8-10 7-8-4-8 1-6 6-10-5 1-9-4-7-8-4 1-12 9-2 6-5Z"/><circle cx="32" cy="32" r="10"/>',
  sound: '<path d="M10 23h10L34 11v42L20 41H10Zm32 0c9 5 9 13 0 18m7-27c16 9 16 27 0 36"/>',
  help: '<circle cx="32" cy="32" r="26"/><path d="M22 23c0-14 24-14 22 0-1 7-12 7-12 16m0 8v3"/>',
  arrow: '<path d="M10 32h44M37 15l17 17-17 17"/>',
  check: '<path d="m12 32 13 13 28-29"/>',
  close: '<path d="m17 17 30 30M17 47l30-30"/>',
  heart: '<path d="M32 55S3 37 6 21 24 7 32 20C40 7 55 5 58 21S32 55 32 55Z"/>',
  star: '<path d="m32 5 7 18 20 1-15 13 5 20-17-11-17 11 5-20L5 24l20-1Z"/>',
};

export function icon(name: string, size = 28, cls = ''): string {
  const dimension = Number.isFinite(size) ? Math.max(1, size) : 28;
  return `<svg class="icon ${esc(cls)}" width="${dimension}" height="${dimension}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? iconPaths.star}</svg>`;
}

const sigilTones: Record<string, string> = {
  jade: '#b4c2b2',
  gold: '#d6b86f',
  mythic: '#dfbd70',
  fire: '#cf7869',
  vermilion: '#c96b60',
  shield: '#89b4a9',
  violet: '#aaa0a0',
};

function sigilFrame(name: string): string {
  if (['wave', 'cloud', 'gourd', 'pearl'].includes(name)) {
    return '<path d="M34 53q-10-9 0-16t0-15q16 7 5 16t1 15m18-23q9-9 18 0t18 0m-88 0q-9-9-18 0t-18 0" /><path d="M47 103q-9 8-18 0t-18 0m122-47q10 9 0 18t0 15m-98-18q-10-9 0-18t0-15" />';
  }
  if (['mirror', 'ring', 'shield', 'coin'].includes(name)) {
    return '<path d="M45 18h90v96H45zM56 28h68v76H56z" /><path d="M34 28h13m86 0h13M34 104h13m86 0h13M90 8v12m0 92v12" />';
  }
  if (['sword', 'swords', 'spear', 'feather', 'flame'].includes(name)) {
    return '<path d="M45 24 71 39m38 30 26 15M135 24l-26 15M71 69 45 84M45 66h20m50 0h20" /><path d="M53 45v-8m74 54v8M127 45v-8m-74 54v8" />';
  }
  if (['lotus', 'sun', 'moon'].includes(name)) {
    return '<path d="M90 15q-20 20 0 36 20-16 0-36Zm0 87q-20-20 0-36 20 16 0 36ZM39 66q20-20 36 0-16 20-36 0Zm102 0q-20-20-36 0 16 20 36 0Z" /><path d="M90 23v-9m0 98v-9M47 66h-9m95 0h-9" />';
  }
  return '<path d="m90 16 12 13 19-1 1 19 13 19-13 19-1 19-19-1-12 13-12-13-19 1-1-19-13-19 13-19 1-19 19 1Z" /><path d="M56 29 124 103m0-74-68 74" />';
}

export function sigil(name: string, tone = 'jade'): string {
  const color = sigilTones[tone] ?? sigilTones.jade;
  return `<svg class="sigil" viewBox="0 0 180 132" aria-hidden="true"><g class="sigil-frame" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity=".42">${sigilFrame(name)}</g><g class="sigil-mark" transform="translate(58 34)" stroke="${color}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${iconPaths[name] ?? iconPaths.star}</g></svg>`;
}

interface PortraitTheme {
  robe: string;
  inner: string;
  trim: string;
  dark: string;
  skin: string;
  hair: string;
  label: string;
}

const portraitThemes: Record<string, PortraitTheme> = {
  swordsman: { robe: '#385e59', inner: '#c2c6b6', trim: '#c7ad72', dark: '#202c2b', skin: '#cbb395', hair: '#232d2b', label: '执剑行者' },
  hermit: { robe: '#66736b', inner: '#d2cdb7', trim: '#b9a979', dark: '#37433e', skin: '#cfb99a', hair: '#313b38', label: '山中隐士' },
  guardian: { robe: '#6d7168', inner: '#b9bdad', trim: '#c7b479', dark: '#303733', skin: '#bda889', hair: '#343b38', label: '山门护法' },
  nezha: { robe: '#a95148', inner: '#e4cfaa', trim: '#d8b86e', dark: '#49332f', skin: '#d5ad8c', hair: '#2c2928', label: '赤焰少年' },
  sorcerer: { robe: '#536c68', inner: '#d0d2c3', trim: '#b2c0b2', dark: '#283432', skin: '#c9b295', hair: '#303b38', label: '行箓术士' },
  fox: { robe: '#845c4d', inner: '#dfd0b4', trim: '#d1ae73', dark: '#372e2a', skin: '#dbc09a', hair: '#534039', label: '狐灵' },
  demon: { robe: '#574c49', inner: '#bba696', trim: '#bd7163', dark: '#272b2a', skin: '#b88d7c', hair: '#302b2b', label: '山海妖魔' },
  peacock: { robe: '#37635c', inner: '#cbd0bb', trim: '#c3a95f', dark: '#263a38', skin: '#d0b491', hair: '#263332', label: '孔雀灵君' },
  golem: { robe: '#647168', inner: '#9da593', trim: '#c0b58a', dark: '#3a453f', skin: '#929887', hair: '#57625b', label: '山石巨灵' },
  traveler: { robe: '#52685e', inner: '#d0cbb9', trim: '#b7a878', dark: '#293632', skin: '#ccb498', hair: '#303a36', label: '行旅修士' },
};

function portraitHair(kind: string, theme: PortraitTheme): string {
  if (kind === 'nezha') {
    return '<path d="M99 74q-10-25 6-34 8-5 15 4 8-9 17-3 17 11 5 34l-7-13-14-5-16 6Z" /><circle cx="98" cy="49" r="8" /><circle cx="145" cy="48" r="8" />';
  }
  if (kind === 'hermit') {
    return '<path d="M94 68q4-31 26-32 24 0 29 32l-10-8-4-12q-16 12-35 7Z" /><path d="M77 69q43-14 86 0l-6 7q-38-8-74 1Z" fill="#9e9c84" stroke="#363f3a" />';
  }
  if (kind === 'sorcerer') {
    return '<path d="M95 67q2-29 27-31 24 2 29 31l-11-6-4-11q-16 10-35 6Z" /><path d="M89 47q31-15 66 0l-5 7q-29-7-56 1Z" fill="#849286" stroke="#33413c" /><path d="m119 39 4-17 5 17" fill="#d1bd83" />';
  }
  if (kind === 'guardian') {
    return '<path d="m94 72 3-24 20-13 23 9 8 28-12-9-5-15-14 6-14-4Z" /><path d="m94 47-10-18 24 11m34 0 20-12-11 20" fill="#777a6c" stroke="#c0b27e" />';
  }
  if (kind === 'demon') {
    return '<path d="m96 69-4-21 18-16 30 3 17 22-9 20-8-18-17-8-21 8Z" /><path d="m101 43-7-27 22 21m19-1 20-23-6 31" fill="#534542" stroke="#c17c6e" />';
  }
  if (kind === 'fox') {
    return '<path d="m101 62-15-35 30 23m26 11 22-34-5 39" /><path d="M100 64q2-24 22-25 21 1 23 25l-10-8-12-7-14 7Z" />';
  }
  if (kind === 'peacock') {
    return '<path d="M98 67q2-31 22-34 23 0 26 34l-12-10-13-12-13 13Z" /><path d="m103 42 17-17 5 18 16-16-5 24m-33-9-13-19 1 28" fill="#53756d" stroke="#c5ad68" />';
  }
  return '<path d="M96 69q-2-31 25-35 25 2 29 35l-10-8-5-16-14 5-14-3Z" /><path d="M118 35q12-21 25-8 3 8-5 13" fill="none" stroke="#c7ad72" stroke-width="4" />';
}

function portraitWeapon(kind: string, theme: PortraitTheme): string {
  if (kind === 'swordsman') {
    return '<g stroke-linejoin="round"><path d="m177 128-25 117 7 4 27-117Z" fill="#cbd2c7" stroke="#46534d" /><path d="m174 166 14 4m-27 59-11 13m18-6 9 4" fill="none" stroke="#c4ad70" stroke-width="3" /></g>';
  }
  if (kind === 'guardian') {
    return '<path d="M34 108v143m-12-113 12-28 13 28-13-7Zm-8 6 20 0" fill="#c5c1a9" stroke="#6d755f" stroke-width="2" /><path d="m25 171 18 0m-14 64 10 0" stroke="#b9a86f" stroke-width="3" />';
  }
  if (kind === 'nezha') {
    return '<path d="m181 103 5-22 7 3-5 24m-5-17q22-3 23-24-9 19-28 15" fill="none" stroke="#d5b06d" stroke-width="3" /><path d="M169 125q-8 15 0 25m11-21q10 12 3 22" fill="none" stroke="#c46e5c" stroke-width="3" />';
  }
  if (kind === 'hermit' || kind === 'sorcerer') {
    return '<path d="M187 105v147m-11-147q12-12 23 0m-23 4q12 11 23 0m-11-14v8" fill="none" stroke="#b9a778" stroke-width="4" /><path d="M184 141h7m-7 22h7" stroke="#d0c8ad" stroke-width="1.5" />';
  }
  if (kind === 'demon') {
    return '<path d="m187 126-29 117 8 3 30-116Z" fill="#abaea1" stroke="#574c49" /><path d="m165 160 18 5m-28 63 12 10" stroke="#bd7163" stroke-width="3" />';
  }
  if (kind === 'fox') {
    return '<path d="M183 151q-17-12-25 2 11 1 14 11-9 9-1 17 18-8 12-30Z" fill="#d3ad73" stroke="#553c34" stroke-width="2" />';
  }
  if (kind === 'peacock') {
    return '<path d="M182 146q-4 32-20 46m20-46q14 24 4 44m-4-44q-14 24-4 44" fill="none" stroke="#c7ab60" stroke-width="2" /><path d="M160 193q21 7 33 0" fill="none" stroke="#6e9990" stroke-width="4" />';
  }
  return `<path d="M184 143v105m-9-91h18m-22 87h26" fill="none" stroke="${theme.trim}" stroke-width="4" />`;
}

function golemFigure(theme: PortraitTheme): string {
  return `<g class="portrait-figure" stroke="${theme.dark}" stroke-linejoin="round" stroke-width="2"><path d="m83 126 21-13 35 3 22 18-4 41-20 20-39-4-24-23Z" fill="${theme.robe}" /><path d="m74 148-22 19-14 40 20 13 27-34m81-41 18 14 17 38-19 16-27-28" fill="${theme.robe}" /><path d="m89 178 25 7 8 49 18-2 12-50 20-8 8 60-17 20H86l-19-20Z" fill="${theme.robe}" /><path d="m111 126 9 12 10-11m-35 7-9 19 13 7m44-26 11 17-12 9m-42 34 16 12 16-7 16 8" fill="none" stroke="${theme.trim}" stroke-width="3" /><path d="m99 73 13-18 30 3 16 18-8 31-22 18-28-15Z" fill="#989c88" /><path d="m103 86 13 3m21-3 13-2m-30 12-3 11 9 3m-5 8 17-2" fill="none" stroke="#373d38" stroke-width="3" /><path d="m91 69 10-23 16 13m27-1 17-15 5 29" fill="${theme.robe}" stroke="${theme.trim}" /><path d="m113 231 2 20 21 0 2-20m-55 21h82" fill="none" stroke="${theme.dark}" stroke-width="5" /></g>`;
}

function standardFigure(kind: string, theme: PortraitTheme): string {
  const isFox = kind === 'fox';
  const isPeacock = kind === 'peacock';
  const isGuardian = kind === 'guardian';
  const isDemon = kind === 'demon';
  const child = kind === 'nezha';
  const mantle = isGuardian || isDemon;
  const tail = isFox
    ? '<path d="M79 184q-36-46-21-92 9 45 47 52-34-30-18-69 2 40 42 55-35-6-29 51" fill="#8b6651" stroke="#3c312c" stroke-width="2" /><path d="M68 111q9 14 25 18m-14-40q5 18 24 31" fill="none" stroke="#d0b795" stroke-width="3" />'
    : '';
  const feathers = isPeacock
    ? `<g fill="none" stroke="${theme.trim}" stroke-width="1.4"><path d="M93 137Q49 89 61 36q34 22 42 81m-27 36Q34 117 31 72q39 11 61 62m52-5q43-48 31-101-34 22-42 81m26 27q42-56 45-101-39 11-61 62" /><path d="M62 40q17 1 22 18-17 2-22-18m-26 38q17-1 25 13-17 5-25-13m111-37q-17 1-22 18 17 2 22-18m26 38q-17-1-25 13 17 5 25-13" stroke="#729b91" stroke-width="4" /></g>`
    : '';
  const robeLines = child
    ? '<path d="m99 137 20 36 18-36m-24 34-6 53m19-48 17 48m-40-40 34 1" fill="none" stroke="#e0c383" stroke-width="2" />'
    : '<path d="m101 129 19 29 19-29m-29 28-10 67m18-57 7 60m11-69 17 61m-60-34 28 16 28-16m-60 28 31 13 31-13" fill="none" stroke="#d1c5a0" stroke-width="1.5" opacity=".74" />';
  const armor = mantle
    ? `<path d="m91 131-24-8-18 17 15 23 30-10m52-22 24-8 18 17-15 23-30-10" fill="#65665c" stroke="${theme.trim}" stroke-width="2" /><path d="m64 135 17 8-12 9m92-17-17 8 12 9" fill="none" stroke="${theme.inner}" stroke-width="2" />`
    : '';
  const sash = child
    ? '<path d="M52 148q42 35 95 12 34-15 51 1-20 12-31 29-14-17-40-8-42 16-77-18Z" fill="#c55d4f" stroke="#e0b878" stroke-width="1.5" />'
    : '<path d="m111 154 17 9 16-9-8 53-14 31-13-27Z" fill="#cbc6ae" stroke="#a8a88f" stroke-width="1.4" />';
  return `<g class="portrait-figure" stroke="${theme.dark}" stroke-width="1.6" stroke-linejoin="round">${tail}${feathers}<path d="M101 116 83 123q-19 8-27 34l-22 68q25 17 60 7l26-28 23 29q35 8 75-9l-24-68q-8-27-30-33l-25-9Z" fill="${theme.robe}" /><path d="M86 127 64 154l-8 37 20 8 23-46m56-25 24 27 13 38-20 8-27-44" fill="${theme.robe}" /><path d="m70 193 10 8m82-8 10 9" fill="none" stroke="${theme.trim}" stroke-width="3" /><path d="M103 112h35l9 18-26 25-27-26Z" fill="${theme.inner}" stroke="${theme.dark}" /><path d="m119 148 8 3-7 79 15-6-14 26-16-22 10 3Z" fill="${theme.trim}" stroke="${theme.dark}" />${robeLines}${armor}<path d="M107 97q-5 16-1 25l14 13 16-13q6-14 0-27Z" fill="${theme.skin}" /><path d="M105 75q2-24 16-25 20 1 22 26l-4 20-15 12-16-12Z" fill="${theme.skin}" stroke="${theme.dark}" /><path d="m106 82 10-2m17 0 9 2m-18 4-1 11 5 2m-7 8q8 3 15 0" fill="none" stroke="#393b37" stroke-width="1.8" /><path d="${child ? 'M104 81q10 5 18 0t17 1' : isFox ? 'M105 80q8 2 13-2m16 1 8 4' : 'M103 78q13-7 25-3 10 3 15 8'}" fill="none" stroke="${theme.dark}" stroke-width="3" />${portraitHair(kind, theme)}<path d="M96 104q-7-2-8 7m61-7q8-2 9 7" fill="none" stroke="${theme.trim}" stroke-width="2" /><path d="M95 235q24 10 47 2" fill="none" stroke="${theme.trim}" stroke-width="2" />${sash}<path d="M75 218 57 244m113-27 19 25" stroke="${theme.inner}" stroke-width="4" stroke-linecap="round" />${portraitWeapon(kind, theme)}</g>`;
}

export function portrait(kind: string, large = false): string {
  const theme = portraitThemes[kind] ?? portraitThemes.traveler;
  const figure = kind === 'golem' ? golemFigure(theme) : standardFigure(kind, theme);
  return `<svg class="portrait${large ? ' portrait-large' : ''}" viewBox="0 0 240 280" role="img" aria-label="${esc(theme.label)}"><g class="portrait-ground" fill="none" stroke="#b9b6a0" stroke-linecap="round"><path d="M36 257q38-13 79-4t88 0" stroke-width="2" opacity=".45"/><path d="m57 258-7 4m132-5 8 4m-72-5v5" stroke-width="1" opacity=".34"/></g><g class="portrait-halo" fill="none" stroke="${theme.inner}" stroke-width="1.2" opacity=".33"><path d="M39 103q15-20 32-22m130 22q-15-20-32-22M57 66q15-13 30-14m66 0q15 1 30 14"/><path d="M50 117q-8 9-9 19m148-19q8 9 9 19" stroke-dasharray="20 9"/></g>${figure}</svg>`;
}

export function landscape(): string {
  const skyId = nextArtId('sky');
  return `<svg class="landscape" viewBox="0 0 800 840" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${skyId}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#303a37"/><stop offset=".54" stop-color="#68746d"/><stop offset="1" stop-color="#a2a79a"/></linearGradient></defs>
    <g class="landscape-sky"><rect width="800" height="840" fill="url(#${skyId})"/><path d="M0 197q76-30 152-1t150 0m-234 13q79-22 150 0t146-2m239-31q73-28 149 1t148 0m-254 13q74-20 145 0t148-1" fill="none" stroke="#c8ccc0" stroke-width="2" opacity=".25"/><path d="M0 300q69-17 130-2m534-8q68-18 136-1" fill="none" stroke="#d7d7cb" stroke-width="1" opacity=".22"/></g>
    <g class="landscape-distant"><path d="M0 398q58-37 102-40 54-4 96-57 39-50 79-59 37-8 70 20 41 36 82 70 35 28 84 16 47-12 86-70 38-56 75-64 47-11 78 34 25 37 48 53v246H0Z" fill="#64746c"/><path d="M0 408q72-38 128-30 40 5 75-43 36-51 80-66 47-16 94 30 43 42 94 69 48 24 96-9 36-25 73-79 31-45 65-47 49-3 95 56" fill="none" stroke="#c2c7b9" stroke-width="2" opacity=".37"/><path d="M0 447q76-35 137-28t122-37q49-34 93-2 46 34 94 58 44 21 97 3 50-17 96-62 57-55 115-29 25 11 46 29v174H0Z" fill="#778179" opacity=".8"/></g>
    <g class="landscape-middle"><path d="M0 474q60-47 124-20 38 17 71-8 47-37 83-25 40 13 72 67 26 45 73 42 44-3 83-55 37-50 79-60 50-12 82 22 35 37 67 24 35-15 66-54v321H0Z" fill="#4c5b53"/><path d="M0 492q77-52 132-26 45 22 81-4 45-32 77-15 30 15 60 62 36 57 84 48 52-9 93-65 41-55 84-54 46 1 72 37 28 38 68 19 25-12 49-36" fill="none" stroke="#aeb6a7" stroke-width="2" opacity=".37"/><path d="M0 545q76-49 129-19 38 21 72 7 43-17 81 13 42 33 82 76 37 40 82 12 32-20 62-62 54-75 113-61 33 8 60 38 34 39 70 19 24-14 49-37v309H0Z" fill="#45554c"/><path d="M232 542q33-19 61 5m184 73q35 6 61-19m138-51q32-12 54 13" fill="none" stroke="#d1c9b0" stroke-width="1.4" opacity=".32"/></g>
    <g class="landscape-architecture" stroke="#d2c8a9" stroke-linejoin="round" opacity=".78"><g transform="translate(523 369)"><path d="M-42 75h145M-24 74V32h111v42M-35 34 31 4l69 30Zm12-11L31-4l52 27M12 74V51h36v23" fill="#505b51" stroke-width="2"/><path d="M-36 32h132M-20 43h13m73 0h13M-25 79h116" fill="none" stroke-width="1.2"/><path d="m-46 35 77-37 81 37" fill="none" stroke-width="4"/><path d="M21 74V55q9-11 18 0v19Z" fill="#a65349" stroke-width="1"/></g><g transform="translate(338 484)"><path d="M-31 41h75M-21 40V11h55v29M-38 12-1-7l39 19Zm18 28V22h31v18" fill="#545d51" stroke-width="1.7"/><path d="M-43 44h98m-67-2v-9m34 9v-9" fill="none" stroke-width="1.2"/></g><path d="M289 536q-36-19-67-3m322-104q29-18 55-5" fill="none" stroke-width="1.2" opacity=".55"/></g>
    <g class="landscape-near"><path d="M0 647q74-50 131-29 53 20 93 6 61-22 110 31 50 53 103 28 57-26 105-79 58-64 116-44 49 17 78 72 27 50 64 44v164H0Z" fill="#39483f"/><path d="M0 704q60-37 114-26 64 12 110-11 66-33 115 24 49 56 98 49 47-6 95-53 59-58 111-48 69 14 105 80 21 39 52 43v78H0Z" fill="#303f38"/><path d="M0 784q85-36 162-18 73 17 143-12 61-25 112 2 51 28 118 6 77-26 152-7 61 16 113 49v36H0Z" fill="#283732"/><path d="M401 399q-33 44 4 83 41 43 2 90-42 51-3 99 31 39-5 79-28 31 6 90" fill="none" stroke="#c3cbc0" stroke-width="57" opacity=".25" stroke-linecap="round"/><path d="M401 399q-33 44 4 83 41 43 2 90-42 51-3 99 31 39-5 79-28 31 6 90" fill="none" stroke="#d6ddd2" stroke-width="2" opacity=".49" stroke-linecap="round"/><path d="M80 711q68-31 106-5t69-2q36-28 60 5" fill="none" stroke="#bbaa7b" stroke-width="2" opacity=".62"/><g fill="none" stroke="#adb09b" stroke-linecap="round"><path d="M67 679v-92m0 21q-28-25-32-53 26 11 36 37m-4 0q28-29 37-55 3 29-30 59m0-9q-27-12-38-36m600 117V553m0 51q-41-30-43-67 37 15 48 49m-3 1q37-38 45-72 5 36-39 76m-1-12q-25-18-37-43M742 637v-67m0 22q-20-17-23-38 20 8 28 28m-3 2q19-18 25-40 2 22-23 45" stroke-width="4"/><path d="M39 603q15 9 30 4m569-54q19 12 40 6m42-8q14 7 28 2" stroke-width="2"/></g></g></svg>`;
}
