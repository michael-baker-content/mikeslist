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

export function classifyEventText(text) {
  const value = String(text || "");
  return {
    eventTypes: unique(EVENT_TYPE_RULES.filter(([, pattern]) => pattern.test(value)).map(([type]) => type)),
    isNonArtistListing: NON_ARTIST_RULES.some((pattern) => pattern.test(value))
  };
}

export function mergeClassifications(...items) {
  return {
    eventTypes: unique(items.flatMap((item) => item?.eventTypes || []))
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
