/**
 * Realistic FTC Mecanum Drive Physics Engine
 *
 * Models:
 *  - DC motor with back-EMF torque curve
 *  - Mecanum X-pattern wheel layout with roller geometry
 *  - Anisotropic friction at each wheel (high µ perp to roller, low along roller)
 *  - Robot rigid body: mass, moment of inertia
 *  - Field surface kinetic friction / drag
 *  - Wall & basket triangle collision with restitution
 *  - Robot-to-robot pushing with momentum
 */

// ──────────── Types ────────────
export interface Vec2 { x: number; y: number }
export interface PhysicsState {
  pos: Vec2;
  heading: number;       // radians
  vel: Vec2;             // world-frame velocity (in/s)
  omega: number;         // angular velocity (rad/s)
  wheelSpeeds: number[]; // [FL, BL, FR, BR] actual angular speed (rad/s)
}

// ──────────── Constants (real FTC values) ────────────

// Robot
const ROBOT_MASS_LB = 42;                             // typical competition robot
const ROBOT_MASS_KG = ROBOT_MASS_LB * 0.453592;
const ROBOT_MASS_SLUGS = ROBOT_MASS_LB / 32.174;      // lb·s²/ft → for imperial
const ROBOT_MASS = ROBOT_MASS_KG;                      // we'll work in SI-ish then convert at end
const ROBOT_WIDTH_IN  = 18;                            // inches
const ROBOT_LENGTH_IN = 18;

// Moment of inertia ≈ (1/12) * m * (w² + l²) for rectangle
const W_M = ROBOT_WIDTH_IN  * 0.0254;                 // metres
const L_M = ROBOT_LENGTH_IN * 0.0254;
const MOI = (1 / 12) * ROBOT_MASS * (W_M * W_M + L_M * L_M); // kg·m²

// Wheelbase geometry (centre to each wheel)
const TRACK_HALF_W = 7.5;   // inches — half track width
const WHEEL_BASE_HALF_L = 7.0; // inches — half wheelbase length
const R_GEOM = TRACK_HALF_W + WHEEL_BASE_HALF_L;      // rotation "lever arm" in inches

// Mecanum wheel
const WHEEL_RADIUS_IN = 1.89;                         // 96mm goBILDA mecanum ≈ 1.89 in
const WHEEL_RADIUS_M  = WHEEL_RADIUS_IN * 0.0254;
const ROLLER_ANGLE = Math.PI / 4;                      // 45°

// DC motor model (goBILDA 5203 series 435 RPM through 13.7:1)
const MOTOR_FREE_SPEED_RPM = 435;
const MOTOR_STALL_TORQUE_NM = 2.1;                    // N·m at gearbox output
const MOTOR_FREE_SPEED_RAD = MOTOR_FREE_SPEED_RPM * (2 * Math.PI / 60); // ≈ 45.6 rad/s
// Wheel free speed = motor free speed (already geared)
const WHEEL_FREE_SPEED = MOTOR_FREE_SPEED_RAD;        // rad/s at wheel
// Max linear speed ≈ WHEEL_FREE_SPEED * WHEEL_RADIUS ≈ 45.6 * 0.048 ≈ 2.19 m/s ≈ 86 in/s
const MAX_ROBOT_SPEED_IN = WHEEL_FREE_SPEED * WHEEL_RADIUS_IN; // ~86 in/s

// Friction
const MU_ROLLER   = 0.12;     // along roller axis — rollers slip easily
const MU_PERP     = 0.85;     // perpendicular to roller — high grip
const MU_FIELD    = 0.55;     // field tile kinetic friction for sliding
const COEFF_RESTITUTION = 0.25; // wall bounce

// Drive tuning: scale motor torque -> contact force. Increase to make robot accelerate/faster.
const DRIVE_FORCE_SCALE = 3.5;

// Strafing tuning: penalize lateral forces so strafing isn't unrealistically fast
const STRAFE_PENALTY = 0.45; // 0..1 where 1 = no penalty, lower = less lateral force

// Each wheel's position relative to robot centre (inches, robot-frame: +x=right, +y=forward)
const WHEEL_POSITIONS: Vec2[] = [
  { x: -TRACK_HALF_W, y:  WHEEL_BASE_HALF_L }, // FL
  { x: -TRACK_HALF_W, y: -WHEEL_BASE_HALF_L }, // BL
  { x:  TRACK_HALF_W, y:  WHEEL_BASE_HALF_L }, // FR
  { x:  TRACK_HALF_W, y: -WHEEL_BASE_HALF_L }, // BR
];

// Roller direction (unit vector in robot-frame) for X-pattern
// FL: roller at +45° → direction (cos45, sin45)
// BL: roller at -45° → direction (cos45, -sin45) — but *contact* is opposite convention
// FR: roller at -45° → direction (-cos45, sin45)
// BR: roller at +45° → direction (-cos45, -sin45)
const S = Math.sin(ROLLER_ANGLE);
const C = Math.cos(ROLLER_ANGLE);
const ROLLER_DIRS: Vec2[] = [
  { x:  C, y:  S },  // FL
  { x:  C, y: -S },  // BL
  { x: -C, y:  S },  // FR
  { x: -C, y: -S },  // BR
];

// Perpendicular to roller
const ROLLER_PERPS: Vec2[] = ROLLER_DIRS.map(d => ({ x: -d.y, y: d.x }));

// Forward direction each wheel spins (unit vec in robot frame)
const WHEEL_FORWARD: Vec2[] = [
  { x: 0, y: 1 }, // FL
  { x: 0, y: 1 }, // BL
  { x: 0, y: 1 }, // FR
  { x: 0, y: 1 }, // BR
];

// ──────────── Helper math ────────────
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const len = (a: Vec2) => Math.sqrt(a.x * a.x + a.y * a.y);
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const add   = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub   = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

function rotateVec(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

// ──────────── Motor model ────────────
/**
 * DC motor torque at a given angular speed.
 * Linear torque-speed curve:  τ = τ_stall * (1 - ω/ω_free)
 * power is clamped [0, stall] since we don't model regenerative braking.
 */
function motorTorque(powerCmd: number, wheelSpeed: number): number {
  // powerCmd ∈ [-1, 1], wheelSpeed in rad/s
  const appliedVoltage = clamp(powerCmd, -1, 1);
  // back-EMF model
  const backEMF = wheelSpeed / WHEEL_FREE_SPEED; // normalised 0..1 at free speed
  const effectiveVoltage = appliedVoltage - backEMF;
  // torque proportional to effective voltage
  const torque = effectiveVoltage * MOTOR_STALL_TORQUE_NM;
  return torque; // can be negative (braking)
}

// ──────────── Main simulation step ────────────
export function stepMecanumPhysics(
  state: PhysicsState,
  motorPowers: number[],   // [FL, BL, FR, BR] -1..1
  dt: number,
  fieldSizeIn: number,
  robotSizeIn: number
): PhysicsState {
  if (dt <= 0) return state;

  const heading = state.heading;
  const cosH = Math.cos(heading), sinH = Math.sin(heading);

  // ---- 1. Motor torques → wheel angular acceleration ----
  const newWheelSpeeds = [...state.wheelSpeeds];
  const wheelForces: Vec2[] = [];          // force at each wheel in robot-frame (inches-based)
  const wheelTorques: number[] = [];       // torque about robot centre for each wheel

  // Precompute robot-frame velocity of centre
  // World vel → robot frame
  const vRobot: Vec2 = {
    x:  state.vel.x * cosH + state.vel.y * sinH,
    y: -state.vel.x * sinH + state.vel.y * cosH
  };

  let totalForceRobot: Vec2 = { x: 0, y: 0 };
  let totalTorque = 0;

  for (let i = 0; i < 4; i++) {
    // --- Motor torque & wheel accel ---
    const tau = motorTorque(motorPowers[i], newWheelSpeeds[i]);
    // Wheel inertia is small, approximate instant response
    const wheelInertia = 0.002; // kg·m² (small)
    const wheelAlpha = tau / wheelInertia;
    newWheelSpeeds[i] += wheelAlpha * dt;
    // clamp to free speed
    newWheelSpeeds[i] = clamp(newWheelSpeeds[i], -WHEEL_FREE_SPEED, WHEEL_FREE_SPEED);

    // --- Ground contact velocity for this wheel ---
    const wp = WHEEL_POSITIONS[i]; // robot-frame position
    // velocity of wheel contact point (robot-frame)
    // v_contact = v_robot + omega × r  (2D: ω cross r = (-ω*ry, ω*rx))
    const vContact: Vec2 = {
      x: vRobot.x + (-state.omega * wp.y),
      y: vRobot.y + ( state.omega * wp.x)
    };

    // Wheel surface velocity (in robot-frame, along wheel forward direction)
    const wheelSurfaceSpeed = newWheelSpeeds[i] * WHEEL_RADIUS_IN; // in/s in robot-frame +y

    // The "driven" velocity the wheel tries to push
    const drivenVel: Vec2 = { x: 0, y: wheelSurfaceSpeed };

    // Slip velocity = contact velocity - driven velocity
    const slipVel = sub(vContact, drivenVel);

    // --- Anisotropic friction ---
    // Decompose slip into roller-axis and perp-to-roller
    const rDir  = ROLLER_DIRS[i];
    const rPerp = ROLLER_PERPS[i];
    const slipRoller = dot(slipVel, rDir);
    const slipPerp   = dot(slipVel, rPerp);

    // Force resisting slip (Coulomb-like, proportional to slip, capped by µ*N)
    // Normal force per wheel ≈ mg/4 (even distribution)
    const g = 9.81; // m/s²
    const normalForce = (ROBOT_MASS * g) / 4; // Newtons
    // Convert to inch-based force: F_in = F_N / 0.0254 ... 
    // Actually let's stay in N and convert displacement at the end.
    // We'll work everything in metres during force calc, convert pos at end.

    const maxRollerForce = MU_ROLLER * normalForce;
    const maxPerpForce   = MU_PERP   * normalForce;

    // Slip in m/s
    const slipRollerM = slipRoller * 0.0254;
    const slipPerpM   = slipPerp   * 0.0254;

    // Use tanh for smooth Coulomb (avoid discontinuity at zero)
    const smoothing = 8.0; // higher = sharper transition
    const fRoller = -maxRollerForce * Math.tanh(smoothing * slipRollerM);
    const fPerp   = -maxPerpForce   * Math.tanh(smoothing * slipPerpM);

    // Total force from this wheel (in N, robot-frame)
    const fWheel: Vec2 = add(
      scale(rDir,  fRoller),
      scale(rPerp, fPerp)
    );

    // --- Driving force from motor torque (converted to linear force at contact) ---
    // f_drive = torque / wheel_radius (N), applied along wheel forward direction (robot-frame)
    const driveForceN = (tau * DRIVE_FORCE_SCALE) / WHEEL_RADIUS_M; // N (scaled)
    const driveForceRobot: Vec2 = scale(WHEEL_FORWARD[i], driveForceN);

    // Combine wheel friction and drive force
    const combined = add(fWheel, driveForceRobot);
    // Penalize lateral (robot-frame X) force to reduce excessive strafing
    const combinedPenalized: Vec2 = { x: combined.x * STRAFE_PENALTY, y: combined.y };
    totalForceRobot = add(totalForceRobot, combinedPenalized);

    // Torque about robot centre from this wheel (in N·m)
    // τ = r × F  (2D: rx*Fy - ry*Fx) — positions in metres
    const rM: Vec2 = { x: wp.x * 0.0254, y: wp.y * 0.0254 };
    totalTorque += rM.x * fWheel.y - rM.y * fWheel.x;
  }

  // ---- 2. Field surface friction (sliding resistance on tiles) ----
  const speedM = len(state.vel) * 0.0254; // m/s
  if (speedM > 0.01) {
    const frictionForce = MU_FIELD * ROBOT_MASS * 9.81;
    // opposing direction (world frame → robot frame)
    const vMag = len(vRobot) * 0.0254;
    if (vMag > 0.001) {
      const fFrictionRobot: Vec2 = {
        x: -frictionForce * (vRobot.x * 0.0254) / vMag,
        y: -frictionForce * (vRobot.y * 0.0254) / vMag
      };
      totalForceRobot = add(totalForceRobot, fFrictionRobot);
    }
  }

  // Rotational drag (bearing friction + scrub)
  const rotDragCoeff = 0.15; // N·m per rad/s
  totalTorque -= rotDragCoeff * state.omega;

  // ---- 3. Integrate accelerations ----
  // a = F/m  (in m/s², robot-frame)
  const aRobot: Vec2 = {
    x: totalForceRobot.x / ROBOT_MASS,
    y: totalForceRobot.y / ROBOT_MASS
  };
  const alpha = totalTorque / MOI; // rad/s²

  // Update robot-frame velocities (m/s)
  const newVRobotM: Vec2 = {
    x: vRobot.x * 0.0254 + aRobot.x * dt,
    y: vRobot.y * 0.0254 + aRobot.y * dt
  };

  // Convert back to in/s, world-frame
  const newVRobotIn: Vec2 = {
    x: newVRobotM.x / 0.0254,
    y: newVRobotM.y / 0.0254
  };

  // Robot-frame → world-frame
  const newVelWorld: Vec2 = {
    x: newVRobotIn.x * cosH - newVRobotIn.y * sinH,
    y: newVRobotIn.x * sinH + newVRobotIn.y * cosH
  };

  const newOmega = state.omega + alpha * dt;

  // ---- 4. Integrate position ----
  let newX = state.pos.x + newVelWorld.x * dt;
  let newY = state.pos.y + newVelWorld.y * dt;
  let newHeading = state.heading + newOmega * dt;
  // Normalise heading
  const twoPi = Math.PI * 2;
  newHeading = ((newHeading % twoPi) + twoPi) % twoPi;

  // ---- 5. Collisions ----
  const half = robotSizeIn / 2;
  let vx = newVelWorld.x;
  let vy = newVelWorld.y;
  let om = newOmega;

  // Wall collisions with restitution
  if (newX < half) {
    newX = half;
    vx = Math.abs(vx) * COEFF_RESTITUTION;
  } else if (newX > fieldSizeIn - half) {
    newX = fieldSizeIn - half;
    vx = -Math.abs(vx) * COEFF_RESTITUTION;
  }
  if (newY < half) {
    newY = half;
    vy = Math.abs(vy) * COEFF_RESTITUTION;
  } else if (newY > fieldSizeIn - half) {
    newY = fieldSizeIn - half;
    vy = -Math.abs(vy) * COEFF_RESTITUTION;
  }

  // Basket corner collisions (triangles in top-left and top-right)
  const bSize = 24.5;
  const buf = half;
  const limit = bSize + buf;
  // Top-left basket (blue)
  if (newX + newY < limit) {
    const push = (limit - (newX + newY)) * 0.5;
    newX += push;
    newY += push;
    vx *= COEFF_RESTITUTION;
    vy *= COEFF_RESTITUTION;
  }
  // Top-right basket (red)
  if ((fieldSizeIn - newX) + newY < limit) {
    const push = (limit - ((fieldSizeIn - newX) + newY)) * 0.5;
    newX -= push;
    newY += push;
    vx *= COEFF_RESTITUTION;
    vy *= COEFF_RESTITUTION;
  }

  return {
    pos: { x: newX, y: newY },
    heading: newHeading,
    vel: { x: vx, y: vy },
    omega: om,
    wheelSpeeds: newWheelSpeeds
  };
}

// ──────────── Robot-to-robot collision ────────────
export function resolveRobotCollision(
  a: PhysicsState, aSize: number,
  b: PhysicsState, bSize: number
): { a: PhysicsState; b: PhysicsState } {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = (aSize + bSize) / 2;

  if (dist >= minDist || dist < 0.01) return { a, b };

  // Normal vector
  const nx = dx / dist;
  const ny = dy / dist;

  // Separate positions
  const overlap = minDist - dist;
  const halfPush = overlap * 0.5;
  const newA = { ...a, pos: { x: a.pos.x + nx * halfPush, y: a.pos.y + ny * halfPush } };
  const newB = { ...b, pos: { x: b.pos.x - nx * halfPush, y: b.pos.y - ny * halfPush } };

  // Relative velocity along collision normal
  const relVx = a.vel.x - b.vel.x;
  const relVy = a.vel.y - b.vel.y;
  const relVn = relVx * nx + relVy * ny;

  if (relVn > 0) return { a: newA, b: newB }; // separating

  // Impulse (equal mass)
  const e = COEFF_RESTITUTION;
  const j = -(1 + e) * relVn / 2; // equal mass → /2

  newA.vel = { x: a.vel.x + j * nx, y: a.vel.y + j * ny };
  newB.vel = { x: b.vel.x - j * nx, y: b.vel.y - j * ny };

  // Spin transfer (rough contact)
  const spinTransfer = 0.15;
  newA.omega += spinTransfer * j;
  newB.omega -= spinTransfer * j;

  return { a: newA, b: newB };
}

// ──────────── Speed helpers for UI ────────────
export const MAX_LINEAR_SPEED_IN = MAX_ROBOT_SPEED_IN;
export const WHEEL_FREE_SPEED_RAD = WHEEL_FREE_SPEED;
