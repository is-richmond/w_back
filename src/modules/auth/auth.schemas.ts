import { Type } from '@sinclair/typebox';

const Email = Type.String({ format: 'email', maxLength: 254 });
const Otp = Type.String({ pattern: '^[0-9]{6}$', description: '6-digit code' });
const Pin = Type.String({ pattern: '^[0-9]{4}$', description: '4-digit PIN' });

export const RequestOtpBody = Type.Object({ email: Email });

export const VerifyOtpBody = Type.Object({ email: Email, code: Otp });

export const SetPinBody = Type.Object({ pin: Pin });

export const VerifyPinBody = Type.Object({ email: Email, pin: Pin });

/** Returned by verify-otp: a temporary initiation token (no refresh yet). */
export const InitiationResponse = Type.Object({
  initiationToken: Type.String(),
  pinAlreadySet: Type.Boolean(),
});

/** Returned by set-pin / verify-pin / refresh: the access token in JSON. */
export const SessionResponse = Type.Object({
  accessToken: Type.String(),
  user: Type.Object({
    id: Type.String({ format: 'uuid' }),
    email: Email,
    displayName: Type.Union([Type.String(), Type.Null()]),
  }),
});

export const MessageResponse = Type.Object({ message: Type.String() });
