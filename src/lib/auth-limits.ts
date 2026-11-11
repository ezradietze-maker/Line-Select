/** The longest each sign-up field may be: the form stops typing there, and the server refuses anything longer. */
export const AUTH_LIMITS = { email: 200, password: 500, displayName: 80 } as const;

/**
 * What's wrong with a sign-up, in words that say which field and why — a display name one character too long was
 * told "Email, password, and display name are required." Null when all three are there and fit.
 */
export function signUpProblem(email: unknown, password: unknown, displayName: unknown): string | null {
  const blank = (v: unknown) => typeof v !== "string" || v.length === 0;
  if (blank(email) || blank(password) || blank(displayName)) return "Email, password, and display name are required.";
  if ((displayName as string).length > AUTH_LIMITS.displayName) return `Display name can be at most ${AUTH_LIMITS.displayName} characters.`;
  if ((email as string).length > AUTH_LIMITS.email) return `Email can be at most ${AUTH_LIMITS.email} characters.`;
  if ((password as string).length > AUTH_LIMITS.password) return `Password can be at most ${AUTH_LIMITS.password} characters.`;
  return null;
}
