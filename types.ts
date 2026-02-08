
export interface Vector2 {
  x: number;
  y: number;
}

export type SampleType = 'green' | 'purple' | 'yellow';
export type Alliance = 'red' | 'blue';

export interface Sample {
  id: string;
  pos: Vector2;
  type: SampleType;
  isPickedUp: boolean;
}

export interface LaunchedSample {
  id: string;
  pos: Vector2;
  target: Vector2;
  type: SampleType;
  progress: number; // 0 to 1
  isScored: boolean;
  velocity?: Vector2; // Initial velocity for realistic physics
  launchAngle?: number; // Launch angle in radians
  timeElapsed?: number; // Time elapsed since launch
  flightTime?: number; // Total flight duration for smooth animation
}

export interface RobotState {
  pos: Vector2;
  heading: number; // in radians
  size: Vector2; // width and height in inches
  heldSamples: SampleType[];
  intakeActive?: boolean;
}

export interface GamepadState {
  connected: boolean;
  axes: number[];
  buttons: boolean[];
}

export interface FieldConfig {
  sizeInches: number;
  gridCells: number;
  pixelsPerInch: number;
}
