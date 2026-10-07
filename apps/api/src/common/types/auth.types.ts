export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  sid?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  sessionId?: string;
}
