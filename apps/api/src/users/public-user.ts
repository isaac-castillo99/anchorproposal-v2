/** Authentication credentials must never be serialized by user management APIs. */
export function publicUser<T extends { passwordHash: string; refreshToken: string | null }>(user: T): Omit<T, 'passwordHash' | 'refreshToken'>;
export function publicUser<T extends { passwordHash: string; refreshToken: string | null }>(user: T | null): Omit<T, 'passwordHash' | 'refreshToken'> | null;
export function publicUser<T extends { passwordHash: string; refreshToken: string | null }>(user: T | null) {
  if (!user) return null;
  const { passwordHash: _passwordHash, refreshToken: _refreshToken, ...result } = user;
  return result;
}
