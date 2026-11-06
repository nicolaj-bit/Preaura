// Supportadressen, der står på appens forside. Kan overstyres pr. miljø med
// PREAURA_SUPPORT_EMAIL; ellers virksomhedens adresse fra privatlivspolitikken.
export const SUPPORT_EMAIL =
  (typeof process !== "undefined" && process.env?.PREAURA_SUPPORT_EMAIL) ||
  "nicolaj@lalatoto.dk";
