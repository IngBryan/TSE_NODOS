export interface Scale {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  active: boolean;
}

export interface WeighingEvent {
  id: number;
  scaleId: number;
  licensePlate: string;
  /** ISO 8601 */
  datetime: string;
  /** Kilograms */
  weight: number;
}

export type ScaleInput = Omit<Scale, "id">;
