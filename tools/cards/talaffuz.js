// Pinyin bo'g'inini (tonsiz) o'zbekcha o'qilishiga aylantiradi. Taxminiy, o'quvchilar uchun.
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const INI_UZ = { b: 'b', p: 'p', m: 'm', f: 'f', d: 'd', t: 't', n: 'n', l: 'l', g: 'g', k: 'k', h: 'x', j: 'dj', q: 'ch', x: 'sh', zh: 'j', ch: 'ch', sh: 'sh', r: 'r', z: 'dz', c: 'ts', s: 's', y: 'y', w: 'v' };
const FIN_UZ = {
  a: 'a', o: 'o', e: 'e', i: 'i', u: 'u', 'ü': 'yu', er: 'er',
  ai: 'ay', ei: 'ey', ao: 'ao', ou: 'ou', an: 'an', en: 'en', ang: 'ang', eng: 'eng', ong: 'ung',
  ia: 'ya', ie: 'ye', iao: 'yao', iu: 'yu', ian: 'yen', in: 'in', iang: 'yang', ing: 'ing', iong: 'yung',
  ua: 'ua', uo: 'uo', uai: 'uay', ui: 'uey', uan: 'uan', un: 'un', uang: 'uang', ueng: 'ueng',
  'üe': 'yue', 'üan': 'yuan', 'ün': 'yun', ue: 'yue',
};

function syl(s) {
  s = s.toLowerCase().replace(/v/g, 'ü');
  if (s === 'er') return 'er';
  let ini = INITIALS.find((x) => s.startsWith(x)) || '';
  let fin = s.slice(ini.length);
  // j q x y + u = ü
  if (['j', 'q', 'x', 'y'].includes(ini) && fin.startsWith('u')) fin = 'ü' + fin.slice(1);
  if (ini === 'y') {
    // yi, ya, ye, yao, you, yan, yin, yang, ying, yong, yu, yue, yuan, yun
    const map = { i: 'i', a: 'ya', e: 'ye', ao: 'yao', ou: 'you', an: 'yan', in: 'yin', ang: 'yang', ing: 'ying', ong: 'yung', 'ü': 'yu', 'üe': 'yue', 'üan': 'yuan', 'ün': 'yun' };
    return map[fin] || 'y' + fin;
  }
  if (ini === 'w') {
    const map = { u: 'u', a: 'va', o: 'vo', ai: 'vay', ei: 'vey', an: 'van', en: 'ven', ang: 'vang', eng: 'veng' };
    return map[fin] || 'v' + fin;
  }
  // zi ci si zhi chi shi ri — "i" juda qisqa
  if (fin === 'i' && ['z', 'c', 's', 'zh', 'ch', 'sh', 'r'].includes(ini)) return INI_UZ[ini] + 'ı'.replace('ı', 'i');
  if (['j', 'q', 'x'].includes(ini) && fin.startsWith('i')) {
    // jia → dzya kabi o'qilmasin: x+ia = shya
    return INI_UZ[ini] + (FIN_UZ[fin] || fin);
  }
  return (INI_UZ[ini] || '') + (FIN_UZ[fin] || fin);
}

/** syllables: ['ba','ba'] → "ba-ba"; 儿 qo'shimchasi oldingi bo'g'inga "r" bo'lib qo'shiladi */
function talaffuz(sylls, hanzi) {
  const chars = [...hanzi].filter((c) => /\p{Script=Han}/u.test(c));
  const out = [];
  sylls.forEach((s, i) => {
    if (s === 'er' && chars[i] === '儿' && i > 0 && chars[i - 1] !== '女') { out[out.length - 1] += 'r'; return; }
    out.push(syl(s));
  });
  return out.join('-');
}

module.exports = { talaffuz, syl };
