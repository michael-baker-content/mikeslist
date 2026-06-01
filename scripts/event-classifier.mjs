const EVENT_TYPE_RULES = [
  ["karaoke", /\bkaraoke\b/i],
  ["trivia", /\btrivia\b/i],
  ["openMic", /\bopen mic\b/i],
  ["poetry", /\bpoetry|poem\b/i],
  ["book", /\bbook event|author reading|book club\b/i],
  ["chess", /\bchess\b/i],
  ["game", /\bgame night|board game|games?\b/i],
  ["storytelling", /\bstoryslam|story slam|the moth\b/i],
  ["comedy", /\bcomedy|comedian|stand[- ]?up\b/i],
  ["film", /\bfilm screening|movie\b/i],
  ["dance", /\bdance party|dance night|salsa\b/i],
  ["coverBand", /\bcover band|tribute\b/i],
  ["jam", /\bjam\b/i],
  ["themeNight", /\btheme night\b|\b(60'?s|70'?s|80'?s|90'?s|2000'?s|karaoke|trivia|dance|punk|goth|emo|salsa)\s+night\b/i]
];

const NON_ARTIST_RULES = [
  /\bkaraoke\b/i,
  /\btrivia\b/i,
  /\bopen mic\b/i,
  /\bpoetry|poem\b/i,
  /\bbook event|author reading|book club\b/i,
  /\bchess\b/i,
  /\bgame night|board game\b/i,
  /\bstoryslam|story slam|the moth\b/i,
  /\bcomedy|comedian|stand[- ]?up\b/i,
  /\bfilm screening|movie\b/i,
  /\bdance party\b/i,
  /\bopen .*jam\b/i,
  /\bsalsa crazy\b/i,
  /\bblue mondays\b/i,
  /\bmonday night\b/i
];

const THEME_RULES = [
  ["60s", /\b60'?s\b|sixties/i],
  ["70s", /\b70'?s\b|seventies/i],
  ["80s", /\b80'?s\b|eighties/i],
  ["90s", /\b90'?s\b|nineties/i],
  ["2000s", /\b2000'?s\b|aughts/i],
  ["punk", /\bpunk\b/i],
  ["metal", /\bmetal\b/i],
  ["goth", /\bgoth\b/i],
  ["emo", /\bemo\b/i],
  ["salsa", /\bsalsa\b/i],
  ["cumbia", /\bcumbia\b/i],
  ["jazz", /\bjazz\b/i],
  ["blues", /\bblues\b/i],
  ["americana", /\bamericana\b/i],
  ["queer", /\bqueer\b/i]
];

export function classifyEventText(text) {
  const value = String(text || "");
  return {
    eventTypes: unique(EVENT_TYPE_RULES.filter(([, pattern]) => pattern.test(value)).map(([type]) => type)),
    themes: unique(THEME_RULES.filter(([, pattern]) => pattern.test(value)).map(([theme]) => theme)),
    isNonArtistListing: NON_ARTIST_RULES.some((pattern) => pattern.test(value))
  };
}

export function mergeClassifications(...items) {
  return {
    eventTypes: unique(items.flatMap((item) => item?.eventTypes || [])),
    themes: unique(items.flatMap((item) => item?.themes || []))
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
