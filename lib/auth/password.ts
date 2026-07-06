import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const MIN_PASSWORD_LENGTH = 10;

/** Baseline password policy for signup and password change. Returns a
 * user-facing error message, or null when the password is acceptable. */
export function passwordPolicyError(
  password: string,
  email?: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const lower = password.toLowerCase();
  if (lower.includes("password")) {
    return 'Password can\'t contain the word "password".';
  }
  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lower.includes(localPart)) {
    return "Password can't contain your email name.";
  }
  return null;
}
