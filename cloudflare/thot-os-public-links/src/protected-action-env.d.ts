// Optional until separately reviewed booking and adult-gateway origins are
// configured. The runtime rejects all v2 actions while either origin is absent.
interface Env {
  BOOKING_ACTION_BASE_URL?: string;
  /**
   * The safe public-profile origin owns the friendly /{slug}/more entrance.
   * It is deliberately separate from the adult gateway origin so an approved
   * safe snapshot never contains an adult-service URL.
   */
  SAFE_PUBLIC_PROFILE_BASE_URL?: string;
  ADULT_GATEWAY_BASE_URL?: string;
  /**
   * Origin of the separately deployed public-media Worker. This Worker never
   * receives an R2 binding and validates only URLs on this exact origin.
   */
  PUBLIC_MEDIA_BASE_URL?: string;
}
