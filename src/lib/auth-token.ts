export type AuthTokenPayload = {
  sub: string;
  role: string;
  iat: number;
  exp: number;
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const decodeAuthToken = (token: string | null): AuthTokenPayload | null => {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    return JSON.parse(base64UrlDecode(payload)) as AuthTokenPayload;
  } catch {
    return null;
  }
};
