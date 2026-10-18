// Textes envoyés aux écrans : les polices de la tablette ne contiennent que l'alphabet
// latin (avec accents) et une sélection d'emojis (monochromes, Noto Emoji). Tout le
// reste — emojis composés, drapeaux, tons de peau, autres alphabets — afficherait des
// carrés ou des trous : on le simplifie ici, côté serveur, une fois pour tous les écrans.
//
// La liste ci-dessous sert aussi à générer les polices (firmware/tools/gen_fonts.sh lit
// les caractères entre les deux marqueurs) : ajouter un emoji = l'ajouter ici puis
// relancer gen_fonts.sh.

// EMOJIS-DEBUT
export const DEVICE_EMOJIS = [
  // Visages
  '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😋😛😜🤪😎🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤯😳🥵🥶😱😨😰😥😓',
  '🤗🤔🤭🤫😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👻💀👽🤖💩',
  // Mains, cœurs, symboles
  '👍👎👏🙌👋🤝🙏💪👌✌🤞👉👈👆👇✋❤🧡💛💚💙💜🖤🤍🤎💔💕💖💗💘💝',
  '⭐🌟✨🔥💯✅❌⚠❗❓💡🔔📌📍🎯🏁🚩➡⬅⬆⬇🔁🔄➕➖✔☑▶⏸⏹⏭⏮🆕🆗🆓💬💭📣📢🚫⛔🆘♻💤',
  // Fêtes, loisirs, sport
  '🎉🎊🎂🎁🎈🎄🎃🎆🎇🏆🥇🥈🥉🏅🎓🎮🎲🧩🎨🎬🎤🎧🎵🎶🎸🎹🥁🎻📸📷📺📻',
  '⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥊🏊🏃🚴🧘🏋⛷🏄🤸',
  // Repas
  '🍕🍔🍟🌭🥪🌮🌯🍣🍱🍜🍝🍛🥗🍳🥞🧀🍞🥐🍰🧁🍩🍪🍫🍿🍦🍎🍌🍓🍉🍇🍒🍑🥑🥕☕🍵🧃🥤🍺🍻🍷🥂🍾🍸🍹🍽🍴',
  // Voyages, lieux, météo, nature
  '✈🚗🚕🚌🚆🚇🚲🛵🚀⛵🚢🏠🏡🏢🏫🏥🏦🏨🏪⛪🏖🏝⛰🏔🗼🗽🌍🌎🌏🗺🧳⛺',
  '☀🌤⛅🌥☁🌦🌧⛈🌩❄☃⛄🌈☔💧🌊🌙🌕⚡🌸🌹🌻🌷🌺🍀🌲🌳🌴🌵🍁🍂',
  '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦄🐝🦋🐢🐍🐟🐬🐳',
  // Objets du quotidien, travail, maison, personnes
  '📅📆🗓⏰⌚⏳⌛📱💻🖥⌨🖨📞☎📧✉📩📝✏🖊📚📖📕📒📋📎✂🔑🔒🔓🛒💰💳💵💶🏷💼🧾📦🎒',
  '👕👗👟👠🧢👓💄💍💊💉🩺🦷🧹🧺🧼🛁🚿🛏🛋🚪🪴🧸🔧🔨🛠⚙🧰🔋🔌🗑👶👦👧👨👩👴👵💑',
].join('');
// EMOJIS-FIN

const EMOJI_SET = new Set(Array.from(DEVICE_EMOJIS, (c) => c.codePointAt(0)!));

/** Plages des polices de texte (mêmes valeurs que TEXT et TEXT_EXT dans gen_fonts.sh). */
const TEXT_RANGES: [number, number][] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x152, 0x153], [0x2013, 0x2014], [0x2018, 0x201a], [0x201c, 0x201e], [0x2022, 0x2022],
  [0x2026, 0x2026], [0x2039, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2212, 0x2212],
  [0x100, 0x113], [0x116, 0x127], [0x12a, 0x12b], [0x12e, 0x130], [0x132, 0x137], [0x139, 0x13e], [0x141, 0x148],
  [0x14a, 0x14d], [0x150, 0x151], [0x154, 0x161], [0x164, 0x165], [0x16a, 0x17e],
];

function inText(cp: number): boolean {
  for (const [a, b] of TEXT_RANGES) if (cp >= a && cp <= b) return true;
  return false;
}

// Équivalents simples pour quelques caractères courants absents des polices.
const REPLACE: Record<string, string> = {
  '\u2192': '›', // →
  '\u2190': '‹', // ←
  '\u202f': ' ', // espace fine insécable
  '\u2009': ' ',
  '\u200b': '',
  '\u2032': '’',
  '\u2033': '”',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '–',
  '\u2015': '—',
  '\u2027': '·',
};

/** Texte affichable par l'écran : emojis connus gardés, le reste simplifié ou retiré. */
export function deviceText(input: string): string {
  if (!input) return input;
  let s = input.normalize('NFC');
  // Séquences composées (famille, métiers…) : on garde le premier emoji.
  s = s.replace(/‍[\p{Extended_Pictographic}♀♂⚕⚖✈❤](️)?/gu, '');
  s = s
    .replace(/[︎️⃣]/g, '') // sélecteurs de variante, touches 1️⃣
    .replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '') // tons de peau
    .replace(/[\u{1f1e6}-\u{1f1ff}]/gu, '') // drapeaux (lettres régionales)
    .replace(/[\u{e0020}-\u{e007f}]/gu, ''); // étiquettes (drapeaux régionaux)

  let out = '';
  let changed = s !== input;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (inText(cp) || EMOJI_SET.has(cp) || ch === '\n') {
      out += ch;
      continue;
    }
    changed = true;
    if (REPLACE[ch] !== undefined) {
      out += REPLACE[ch];
      continue;
    }
    // Lettre accentuée hors police (ex. « ș ») : la lettre de base.
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    if (base && base !== ch && Array.from(base).every((c) => inText(c.codePointAt(0)!))) out += base;
    // Sinon (emoji inconnu, autre alphabet) : retiré.
  }
  if (!changed) return out;
  const clean = out.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  return clean || (input.trim() ? '…' : '');
}

/** Applique deviceText à toutes les chaînes d'un objet (état envoyé à l'écran). */
export function deviceSafe<T>(value: T): T {
  if (typeof value === 'string') return deviceText(value) as T;
  if (Array.isArray(value)) return value.map((v) => deviceSafe(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Adresses d'images, identifiants, couleurs, hachages : jamais modifiés.
      out[k] = /url$|Url$|^id$|Id$|color$|^pin|Hash$|Salt$|^date$|^start$|^end$|^time$/.test(k) ? v : deviceSafe(v);
    }
    return out as T;
  }
  return value;
}
