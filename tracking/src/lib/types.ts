export interface GpsDevice {
  id: number;
  /** Vehicle the device is installed on */
  licensePlate: string;
  active: boolean;
}

export interface TrackingEvent {
  id: number;
  gpsId: number;
  latitude: number;
  longitude: number;
  /** ISO 8601 */
  datetime: string;
}

export type GpsDeviceInput = Omit<GpsDevice, "id">;
