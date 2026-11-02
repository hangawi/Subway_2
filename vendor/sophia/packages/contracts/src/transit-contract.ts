// Timetable evidence, never a promise about today's delays, cancellations or service disruptions.
export interface TransitSchedule {
  status: 'AVAILABLE' | 'NO_SERVICE' | 'UNKNOWN';
  notice?: 'SUBWAY_SERVICE_UNAVAILABLE';
  requested_departure: string;
  departure_at: string | null;
  arrival_at: string | null;
  transfers: number | null;
  basis: 'TIMETABLE';
  realtime: false;
}
export interface TransitLeg extends TransitSchedule {
  minutes: number | null;
}
export interface DinnerTransitSummary {
  members: number;
  outbound_checked: number;
  return_checked: number;
  unknown: number;
  unavailable: number;
  basis: 'TIMETABLE';
  realtime: false;
}
