/** Original procedural SVG artwork. No external images, fonts, or game assets. */
let artSerial=0;
export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
const iconPaths:Record<string,string>={
 sword:'<path d="M48 8 55 16 27 49 17 39Z"/><path d="m16 35 15 14M23 44 11 58m-3-5 8 8"/>',
 swords:'<path d="m11 8 7 1 30 38-5 5L12 15ZM53 8l-7 1L16 47l5 5 31-37ZM9 43l15 14M40 57l15-14M16 51l-5 9m36-9 6 9"/>',
 spear:'<path d="M49 5 58 7 57 16 40 26l-4-4ZM39 23 10 58m20-32 12 12"/>',
 flame:'<path d="M35 5c2 16-20 17-19 33 0 12 9 20 19 20s19-7 17-18c-1-7-5-11-8-16 0 9-5 12-7 9C31 28 42 15 35 5Z"/><path d="M33 34c2 9-8 9-5 17s14 5 14-2c0-6-7-7-9-15Z"/>',
 shield:'<path d="m32 6 22 8v19c0 13-22 25-22 25S10 46 10 33V14Z"/><path d="m32 15 13 6v11c0 7-13 16-13 16S19 39 19 32V21Zm0 7v15m-7-7h14"/>',
 mirror:'<circle cx="32" cy="29" r="22"/><circle cx="32" cy="29" r="15"/><path d="M26 51v8h12v-8M20 21l9-5m-12 13 13-9m2 31V9"/>',
 fist:'<path d="M15 36V19c0-5 8-5 8 0v12-18c0-5 8-5 8 0v17-18c0-5 8-5 8 0v19-15c0-5 8-5 8 0v22l-8 11v10H22V46l-8-10c-6-10 0-15 5-7l7 9"/>',
 bolt:'<path d="M37 4 13 37h17l-3 24 25-36H35Z"/>',
 lotus:'<path d="M32 55C8 50 6 34 8 26c15 2 23 12 24 29Zm0 0c24-5 26-21 24-29-15 2-23 12-24 29Zm0-1c-18-17-15-28 0-45 15 17 18 28 0 45Z"/>',
 sun:'<circle cx="32" cy="32" r="14"/><circle cx="32" cy="32" r="6"/><path d="M32 3v10m0 38v10M3 32h10m38 0h10M11 11l8 8m26 26 8 8M11 53l8-8m26-26 8-8"/>',
 moon:'<path d="M44 9C21 3 6 27 19 47c9 14 31 14 40-1-22 7-41-16-15-37Z"/><path d="m47 13 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/>',
 eye:'<path d="M4 32s11-18 28-18 28 18 28 18-11 18-28 18S4 32 4 32Z"/><circle cx="32" cy="32" r="11"/><path d="M32 22v20M25 6l7 5 7-5m-14 52 7-5 7 5"/>',
 mountain:'<path d="m4 51 19-33 10 17L45 9l16 42ZM15 39l9-4 7 8m6-13 8-9 8 15M6 57h52"/>',
 cloud:'<path d="M8 43c-12-15 8-25 15-16-2-20 28-19 27 0 16-1 18 20 0 20H25c-15 0-14-15-3-15 6 0 7 8 1 8M6 55h38m7 0h6"/>',
 wave:'<path d="M4 33c11-25 27-28 28-11 0 12-18 18-8 26 5 5 19 4 22-7 8 1 11 6 14 11M4 45c9 13 16 13 25 9m-19 5h48M35 12c15-6 24 4 22 17-1 7-10 12-16 9"/>',
 pearl:'<circle cx="32" cy="30" r="19"/><circle cx="27" cy="24" r="6"/><path d="M15 42 7 57l25-7 25 7-8-15M32 6V2M6 30H2m56 0h4"/>',
 bell:'<path d="M13 45h38l-5-8V25c0-20-28-20-28 0v12ZM9 45v6h46v-6M26 51c0 10 12 10 12 0M27 10V5h10v5"/>',
 flag:'<path d="M15 59V5m1 3h34l-9 12 10 14H17M11 59h15m-2-40 10 7 8-13"/>',
 jade:'<path d="m32 8 16 10 2 22-18 16-18-16 2-22Z"/><circle cx="32" cy="26" r="8"/><path d="M32 5v10m-6 41-3 7m15-7 3 7M20 40l12 9 12-9"/>',
 feather:'<path d="M13 59c5-25 15-47 42-53 6 24-7 44-34 43M19 48 48 16M28 35l-5-12m13 1-3-9M28 36l18-1M20 47l18-1"/>',
 lamp:'<path d="M19 11h26l4 33H15ZM26 44v11m12-11v11M17 58h30M32 8V3m-9 5h18M32 17c-8 9-9 16 0 19 9-3 8-10 0-19Z"/>',
 coin:'<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="19"/><path d="M25 25h14v14H25ZM32 15v5m0 24v5M15 32h5m24 0h5"/>',
 gourd:'<path d="M26 9c-9 6-8 14-1 19-20 8-18 30 7 30s27-22 7-30c7-5 8-13-1-19ZM24 7h16m-8-1V2M22 31l20 3m-20 4 20-3"/>',
 ring:'<ellipse cx="32" cy="32" rx="23" ry="25"/><ellipse cx="32" cy="32" rx="14" ry="16"/><path d="m16 14 7 7m18 22 7 7M16 50l7-7m18-22 7-7M28 7h8m-8 50h8"/>',
 seal:'<path d="M12 33h40v21H12ZM18 28h28l-3-10-9-5-10 4ZM8 54h48v5H8ZM19 38h26m-20 0v11m14-11v11m-20 0h26M26 11l8-7 8 6"/>',
 orbs:'<circle cx="32" cy="12" r="7"/><circle cx="50" cy="24" r="7"/><circle cx="44" cy="48" r="7"/><circle cx="20" cy="48" r="7"/><circle cx="13" cy="24" r="7"/><path d="M24 13 18 18m21-5 7 5m7 13-5 10m-27 14h14M10 31l7 10"/>',
 book:'<path d="M32 16C23 8 12 9 5 11v41c10-3 18-2 27 4 9-6 17-7 27-4V11c-7-2-18-3-27 5Zm0 0v40M12 21l12 3m-12 9 12 3m16-12 12-3m-12 15 12-3"/>',
 gate:'<path d="M7 21h50L32 6ZM12 26h40M16 27v31m32-31v31M9 59h46M24 59V37h16v22M3 20h58"/>',
 camp:'<path d="m32 8 25 48H7Zm0 22 11 26H21ZM4 60h56m-20-44 8-5m-28 5-8-5"/>',
 diamond:'<path d="m32 5 23 27-23 27L9 32Zm0 0v54M9 32h46"/>',
 skull:'<path d="M18 46C-2 27 11 5 32 5s34 22 14 41v12H18ZM23 58V48m9 10V47m9 11V48"/><circle cx="22" cy="29" r="6"/><circle cx="42" cy="29" r="6"/><path d="m29 41 3-5 3 5"/>',
 gear:'<path d="m26 5 12 0 3 8 8 3 8-1 5 11-6 7-1 8 3 8-10 7-8-4-8 1-6 6-10-5 1-9-4-7-8-4 1-12 9-2 6-5Z"/><circle cx="32" cy="32" r="10"/>',
 sound:'<path d="M10 23h10L34 11v42L20 41H10Zm32 0c9 5 9 13 0 18m7-27c16 9 16 27 0 36"/>',
 help:'<circle cx="32" cy="32" r="26"/><path d="M22 23c0-14 24-14 22 0-1 7-12 7-12 16m0 8v3"/>',
 arrow:'<path d="M10 32h44M37 15l17 17-17 17"/>',
 check:'<path d="m12 32 13 13 28-29"/>',
 close:'<path d="m17 17 30 30M17 47l30-30"/>',
 heart:'<path d="M32 55S3 37 6 21 24 7 32 20C40 7 55 5 58 21S32 55 32 55Z"/>',
 star:'<path d="m32 5 7 18 20 1-15 13 5 20-17-11-17 11 5-20L5 24l20-1Z"/>',
};
export function icon(name:string,size=28,cls=''):string{return `<svg class="icon ${esc(cls)}" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]??iconPaths.star}</svg>`;}
export function sigil(name:string,tone='jade'):string{
 const hue=tone==='mythic'?'#e0bb67':tone==='fire'?'#cf8263':tone==='shield'?'#81b7ae':'#98afa0';
 return `<svg class="sigil" viewBox="0 0 180 132" aria-hidden="true"><g fill="none" stroke="${hue}" stroke-width=".6" opacity=".3"><circle cx="90" cy="66" r="56"/><circle cx="90" cy="66" r="48"/><path d="M90 6 142 96H38ZM90 126 38 36h104Z"/>${Array.from({length:16},(_,i)=>`<path transform="rotate(${i*22.5} 90 66)" d="M90 2v7m0 114v7"/>`).join('')}</g><g transform="translate(58 34)" stroke="${hue}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${iconPaths[name]??iconPaths.star}</g></svg>`;
}
export function portrait(kind:string,large=false):string{
 const id='a'+(++artSerial),evil=['fox','demon','peacock','golem'].includes(kind);
 const robe=kind==='nezha'?'#aa4e42':kind==='guardian'?'#777157':kind==='sorcerer'?'#6a7771':evil?'#706259':'#416e69';
 const trim='#c9b47e',skin='#cdb68e';
 let figure='';
 if(kind==='fox'){
  figure=`<g fill="#916957" stroke="#d5b68c" stroke-width="1.2">${[-65,-44,-23,0,23,44,65].map((r,i)=>`<path transform="rotate(${r} 120 184)" d="M120 186Q${30+i*3} 143 96 44Q96 123 132 159Z"/>`).join('')}</g><path d="m95 97-7-37 26 26 20-2 23-26-4 43-11 26-15 13-23-14Z" fill="#d1b991"/><path d="m95 101 21 9-12 4m47-14-20 10 12 4m-28 11 9 3 6-5" stroke="#302b2d" stroke-width="3" fill="none"/><path d="m107 137-24 53 42 40 44-40-30-56Z" fill="#593e3a"/><path d="m119 139-2 44 14 26 6-62" fill="#b9a081"/>`;
 }else if(kind==='golem'){
  figure='<g stroke="#c1ba91" stroke-width="1"><path d="m90 67 37-17 30 22-7 42-29 16-34-22Z" fill="#747f72"/><path d="m68 115 46 10 43-10 32 62-14 39H65l-19-43Z" fill="#54685e"/><path d="m82 139-24 39 22 11 26-53m41 3 20 39-18 10-19-53M91 85l14-5m30-1 15 5m-40 23 27-3" fill="none" stroke-width="4"/><path d="m76 209 10 39h22l8-39m10 0 9 39h22l11-39" fill="#465d54"/></g>';
 }else{
  const peacock=kind==='peacock';
  if(peacock)figure+=`<g opacity=".85">${Array.from({length:11},(_,i)=>`<g transform="rotate(${(i-5)*15} 120 187)"><path d="M120 187Q74 79 112 14Q151 58 120 187" fill="${['#48776d','#567377','#7a725b','#725d73','#a57f52'][i%5]}" stroke="#bcab7b" stroke-width=".6"/><ellipse cx="114" cy="58" rx="9" ry="20" fill="#1e4647" stroke="#cfbd85"/><ellipse cx="114" cy="58" rx="4" ry="9" fill="#bda76f"/></g>`).join('')}</g>`;
  const warrior=kind==='guardian'||kind==='demon';
  figure+=`<path d="M105 111Q68 112 53 170l-21 69 68-18 45 26 63-15-25-59q-8-52-47-62" fill="${robe}" stroke="${trim}" stroke-width="1.3"/><path d="m97 120-16 55 17 66m43-121 21 57-18 65m-28-128-5 95m21-96 10 128" fill="none" stroke="${trim}" opacity=".7"/><path d="m102 112 18 24 21-24-2 74-18 30-24-33Z" fill="${warrior?'#6e5e4b':'#a3a188'}"/><path d="m107 123 18 26 12-30m-36 46 38 18m-36 8 34 10" stroke="#314d49" fill="none"/><path d="m100 68 10-10 21 1 15 17-5 30-19 15-19-15Z" fill="${skin}"/><path d="m101 84 11-2m18 0 11 3m-20 2-2 14 5 1m-10 8h15" fill="none" stroke="#3c4039" stroke-width="1.6"/><path d="M99 84Q82 51 104 39l25 1q33 2 18 51l-7-22-36-4Z" fill="#242e2c"/>`;
  if(kind==='swordsman')figure+=`<path d="m85 65 34-30 41 34-48 7Z" fill="#294641" stroke="${trim}"/><path d="m119 38 4-19 9 3-3 22" fill="#8f8056"/><path d="M130 28q56 7 60-21-6 34-48 34" fill="#b1a27f"/><path d="m173 105-21 134 7 3 21-135Zm-11 18 26 4" fill="#c5c3a3" stroke="#243a36"/><path d="m67 161 35 24-8 12-39-17m101-19 18 26 14-5" fill="${skin}" stroke="#31433e"/>`;
  else if(warrior)figure+=`<path d="m92 73-13-31 26 19 11-36 10 35 28-18-9 36" fill="#706348" stroke="${trim}"/><path d="m62 127 37-8 21 31 27-32 32 15-10 28-45 17-49-21Z" fill="#3e514a" stroke="${trim}"/><path d="m79 130 19 11-14 11m70-22-19 11 18 12m-35 30 3 56m-25-45 43 2m-44 12 45 2" stroke="${trim}" fill="none"/><path d="M43 82v164M24 91l19-34 20 34-20-12Z" fill="#aaa585" stroke="#cebd8c" stroke-width="2"/>`;
  else if(kind==='nezha')figure+=`<circle cx="98" cy="54" r="12" fill="#252c2b"/><circle cx="144" cy="54" r="12" fill="#252c2b"/><path d="M45 73q32 71 120 51t40 73q-8-40-53-49t-84-13Q19 94 45 73" fill="#b65a4c" stroke="#d8a887"/><path d="M109 57h25m-7 23 2 5" stroke="#bd4e44" stroke-width="3"/><circle cx="66" cy="188" r="24" fill="none" stroke="#e1bb65" stroke-width="5"/>`;
  else if(kind==='hermit')figure+=`<path d="m104 103 18 15 19-14-8 39-12 23-14-29Z" fill="#c8c7af"/><path d="M95 61q8-39 31-32l12 32" fill="#536c61" stroke="${trim}"/><path d="m179 65-10 173m10-173q30-25 26 13" stroke="#ac9974" stroke-width="5" fill="none"/><path d="m67 167 29 29-13 10-32-29" fill="${skin}"/>`;
  else if(peacock)figure+=`<path d="m107 58 3-24 10 9 10-9 8 24" fill="#ceac61"/><path d="m116 86 5-6 5 6-5 6Z" fill="#ddc480"/><path d="m83 134 37 51 36-51m-62 30 26 45 24-45" stroke="#d0ad63" stroke-width="3" fill="none"/>`;
  else figure+=`<path d="M94 70 107 26l28 1 17 45-31-14Z" fill="#354d4b" stroke="${trim}"/><path d="m110 39 12 6 10-6" stroke="${trim}" fill="none"/><path d="m60 173 23 15 12-5m60-9 17 13 13-4" stroke="${skin}" stroke-width="9" fill="none"/><path d="M174 158c-14-13 6-27 1-38 20 18 21 28-1 38" fill="#e1a773"/><circle cx="174" cy="148" r="23" fill="#dc9562" opacity=".14"/>`;
 }
 return `<svg class="portrait ${large?'portrait-large':''}" viewBox="0 0 240 280" role="img" aria-label="${esc(kind)}"><defs><radialGradient id="${id}"><stop stop-color="${evil?'#51463b':'#345854'}"/><stop offset="1" stop-color="#112624"/></radialGradient><linearGradient id="${id}fade" x2="0" y2="1"><stop offset=".5" stop-color="#101e1d" stop-opacity="0"/><stop offset="1" stop-color="#101e1d"/></linearGradient></defs><rect width="240" height="280" fill="url(#${id})"/><g fill="none" stroke="#b5a06a" opacity=".35"><circle cx="120" cy="104" r="86"/><circle cx="120" cy="104" r="78"/>${Array.from({length:24},(_,i)=>`<path transform="rotate(${i*15} 120 104)" d="M120 10v7m-3-2h6"/>`).join('')}<path d="M20 255 120 25l100 230ZM120 15v239M16 103h208" opacity=".35"/></g><g transform="translate(0 8)">${figure}</g><rect width="240" height="280" fill="url(#${id}fade)"/><g fill="none" stroke="#b5a06a" opacity=".55"><path d="M12 55V12h45m126 0h45v43M12 225v43h45m126 0h45v-43"/><path d="M17 41V17h24m158 0h24v24M17 239v24h24m158 0h24v-24"/></g></svg>`;
}
export function landscape():string{
 return `<svg class="landscape" viewBox="0 0 800 840" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="landfade" x2="0" y2="1"><stop stop-color="#1e3d39"/><stop offset="1" stop-color="#101c1b"/></linearGradient></defs><rect width="800" height="840" fill="url(#landfade)"/><g fill="none" stroke="#b6a372" opacity=".19"><circle cx="400" cy="95" r="77"/><circle cx="400" cy="95" r="66"/><path d="M360 95h80m-40-40v80"/></g><path d="M0 345 84 235l35 41 99-169 85 159 30-56 94 161 98-205 29 62 58-118 188 208V700H0Z" fill="#2c5149" opacity=".5"/><path d="m140 420 87-211 35 60 25-20 63 119 22-27 44 70m103-124 37-91 49 78 39-107 75 154" fill="none" stroke="#769083" stroke-width="1" opacity=".3"/><path d="M0 399 65 365l41 56 71-28 106 99 62-76 88 88 47-32 97 77 97-161 63 119 63-69V840H0Z" fill="#1b3833"/><path d="M800 584 728 559 660 620l-41-19-116 90-86-102-91 39-75-116-91 76-71-33-89 90v195h800" fill="#142d29"/><path d="M453 200q-172 93-30 171t-90 136q-130 94 75 154t-126 179" fill="none" stroke="#7a9884" stroke-width="26" opacity=".055"/><g fill="none" stroke="#b1b391" opacity=".11">${[315,450,620,740].map((y,i)=>`<path d="M${i%2?430:0} ${y}q80-28 150 0t180 0m-240 8q70-18 140 0t180 0"/>`).join('')}</g><g transform="translate(51 228)" fill="#273d34" stroke="#9f9970" stroke-width=".9" opacity=".65"><path d="M15 126h93M30 126V69h61v57M17 72l42-26 48 26Zm12-27 30-24 35 24ZM40 21 59 8l24 13ZM46 48v-4m25 4v-4M48 92h26v34M6 130h112"/></g><g transform="translate(665 529)" stroke="#82927b" fill="#233f33" opacity=".4"><path d="M-35 55h110L17 21Zm10 0v62h78V55M-43 120H85M17 20V5m-11 74h23v38"/></g><g fill="#c4b781" opacity=".3">${Array.from({length:30},(_,i)=>`<circle cx="${(i*197+43)%780}" cy="${(i*97+23)%800}" r="${i%4===0?1.4:.7}"/>`).join('')}</g></svg>`;
}
