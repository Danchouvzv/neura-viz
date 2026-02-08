
export class PIDController {
  private kp: number;
  private ki: number;
  private kd: number;
  
  private target: number = 0;
  private errorSum: number = 0;
  private lastError: number = 0;
  private lastTime: number = 0;

  constructor(kp: number, ki: number, kd: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
  }

  public setGains(kp: number, ki: number, kd: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
  }

  public setTarget(target: number) {
    this.target = target;
  }

  public update(currentValue: number, dt: number): number {
    if (dt <= 0) return 0;

    const error = this.target - currentValue;
    this.errorSum += error * dt;
    
    // Simple anti-windup
    const maxErrorSum = 100;
    this.errorSum = Math.max(-maxErrorSum, Math.min(maxErrorSum, this.errorSum));

    const errorDeriv = (error - this.lastError) / dt;
    this.lastError = error;

    return (this.kp * error) + (this.ki * this.errorSum) + (this.kd * errorDeriv);
  }

  public reset() {
    this.errorSum = 0;
    this.lastError = 0;
  }
}
