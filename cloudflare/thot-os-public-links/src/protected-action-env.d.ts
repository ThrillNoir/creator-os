// Optional until separately reviewed booking and adult-gateway origins are
// configured. The runtime rejects all v2 actions while either origin is absent.
interface Env {
  BOOKING_ACTION_BASE_URL?: string;
  ADULT_GATEWAY_BASE_URL?: string;
  /**
   * Origin of the separately deployed public-media Worker. This Worker never
   * receives an R2 binding and validates only URLs on this exact origin.
   */
  PUBLIC_MEDIA_BASE_URL?: string;
}
