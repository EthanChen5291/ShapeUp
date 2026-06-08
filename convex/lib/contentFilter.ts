const PROFANITY = [
  "fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy",
  "nigger", "nigga", "faggot", "fag", "asshole", "bastard",
  "slut", "whore", "kike", "spic", "chink", "retard",
];

const RESERVED_USERNAMES = [
  "admin", "administrator", "support", "help", "moderator", "mod",
  "staff", "official", "shapeup", "shape_up", "unchopped", "root",
  "system", "security", "privacy", "legal", "billing",
];

export function normalizeContentToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasProfanity(value: string): boolean {
  const clean = normalizeContentToken(value);
  return PROFANITY.some((word) => clean.includes(word));
}

export function isReservedUsername(value: string): boolean {
  const clean = normalizeContentToken(value);
  return RESERVED_USERNAMES.some((word) => clean === normalizeContentToken(word));
}

export function validateUsernameBusinessRules(username: string): string | null {
  if (hasProfanity(username)) return "Username is not allowed";
  if (isReservedUsername(username)) return "Username is reserved";
  return null;
}
