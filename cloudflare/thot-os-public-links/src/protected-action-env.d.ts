// Optional until separately reviewed booking and adult-gateway origins are
// configured. The runtime rejects all v2 actions while either origin is absent.
interface Env {
  BOOKING_ACTION_BASE_URL?: string;
  ADULT_GATEWAY_BASE_URL?: string;
}
