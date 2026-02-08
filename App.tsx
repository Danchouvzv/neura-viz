
import React, { useState, useEffect, useRef } from 'react';
import Field from './components/Field';
import { useGamepad } from './hooks/useGamepad';
import { RobotState, Vector2, Sample, SampleType, LaunchedSample, Alliance } from './types';
import { FIELD_SIZE_INCHES, ROBOT_SIZE_INCHES } from './constants';
import { PIDController } from './utils/pid';

const ConfigInput: React.FC<{
  label: string, 
  value: number, 
  min: number, 
  max: number, 
  step: number, 
  suffix?: string, 
  onChange: (v: number) => void 
}> = ({ label, value, min, max, step, suffix = "", onChange }) => {
  const [isFocused, setIsFocused] = useState(false);
  const [localStr, setLocalStr] = useState(value.toFixed(2));

  useEffect(() => {
    if (!isFocused) {
      setLocalStr(value.toFixed(2));
    }
  }, [value, isFocused]);

  const handleInputChange = (val: string) => {
    setLocalStr(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) onChange(parsed);
  };

  return (
    <div className="space-y-1.5 group">
      <div className="flex justify-between items-center text-[9px] font-mono">
        <span className="text-neutral-500 uppercase font-bold group-hover:text-neutral-300 transition-colors">{label}</span>
        <div className="flex items-center gap-1 bg-neutral-800/50 px-1 rounded border border-white/5 focus-within:border-purple-500/50 transition-colors">
          <input 
            type="text" 
            value={localStr}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(e) => handleInputChange(e.target.value)}
            className="bg-transparent text-purple-400 w-14 text-right outline-none appearance-none font-bold py-0.5"
          />
          <span className="text-neutral-600 text-[8px]">{suffix}</span>
        </div>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step} 
        value={isNaN(parseFloat(localStr)) ? value : parseFloat(localStr)} 
        onChange={(e) => handleInputChange(e.target.value)}
        className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-600 hover:accent-purple-400 transition-all"
      />
    </div>
  );
};

const INITIAL_SAMPLES: Sample[] = [
    { id: '1a', pos: { x: 24.90, y: 60.00 }, type: 'green', isPickedUp: false },
    { id: '1b', pos: { x: 28.90, y: 60.00 }, type: 'purple', isPickedUp: false },
    { id: '1c', pos: { x: 32.90, y: 60.00 }, type: 'purple', isPickedUp: false },
    { id: '2a', pos: { x: 68, y: 72 }, type: 'purple', isPickedUp: false },
    { id: '2b', pos: { x: 72, y: 72 }, type: 'green', isPickedUp: false },
    { id: '2c', pos: { x: 76, y: 72 }, type: 'purple', isPickedUp: false },
    { id: '3a', pos: { x: 68, y: 89 }, type: 'purple', isPickedUp: false },
    { id: '3b', pos: { x: 72, y: 89 }, type: 'purple', isPickedUp: false },
    { id: '3c', pos: { x: 76, y: 89 }, type: 'green', isPickedUp: false },
];

const App: React.FC = () => {
  const [alliance, setAlliance] = useState<Alliance>('blue');
  const [robot, setRobot] = useState<RobotState>({
    pos: { x: 72, y: 120 },
    heading: -Math.PI / 2,
    size: { x: ROBOT_SIZE_INCHES, y: ROBOT_SIZE_INCHES },
    heldSamples: []
  });

  const [samples, setSamples] = useState<Sample[]>(INITIAL_SAMPLES);
  const [launchedSamples, setLaunchedSamples] = useState<LaunchedSample[]>([]);
  const [score, setScore] = useState(0);
  const [isShootingMode, setIsShootingMode] = useState(false);
  const [lastShotResult, setLastShotResult] = useState<'hit' | 'miss' | null>(null);

  const [partnerActive, setPartnerActive] = useState(false);
  const [partner, setPartner] = useState<RobotState>({
    pos: { x: 24, y: 120 },
    heading: -Math.PI / 2,
    size: { x: ROBOT_SIZE_INCHES, y: ROBOT_SIZE_INCHES },
    heldSamples: []
  });

  const [isRunning, setIsRunning] = useState(false);
  const [driveMode, setDriveMode] = useState<'field' | 'robot'>('field');
  const [fieldWidth, setFieldWidth] = useState(600);
  
  // Odometry drift simulation
  const [positionDrift, setPositionDrift] = useState<Vector2>({ x: 0, y: 0 });
  const [headingDrift, setHeadingDrift] = useState(0);
  const matchStartTime = useRef<number>(0);

  const { getAxes, getButtons } = useGamepad();
  const lastUpdateRef = useRef<number>(performance.now());
  const shootCooldownRef = useRef(false);
  const partnerShootCooldownRef = useRef(false);
  const intakeCooldownRef = useRef(false);
  const partnerIntakeCooldownRef = useRef(false);
  
  const r1Vel = useRef<Vector2>({ x: 0, y: 0 });
  const r1RotVel = useRef<number>(0);
  const r2Vel = useRef<Vector2>({ x: 0, y: 0 });
  const r2RotVel = useRef<number>(0);

  const pids = useRef({
    r1: { x: new PIDController(10, 0, 0.5), y: new PIDController(10, 0, 0.5), h: new PIDController(12, 0, 0.6) },
    r2: { x: new PIDController(10, 0, 0.5), y: new PIDController(10, 0, 0.5), h: new PIDController(12, 0, 0.6) }
  });

  const MAX_SPEED = 76.5; 
  const MAX_ROT_SPEED = 5.5;

  const allianceThemeColor = alliance === 'red' ? 'text-red-500' : 'text-blue-500';
  const allianceBgColor = alliance === 'red' ? 'bg-red-600' : 'bg-blue-600';

  const normalizeRadians = (rad: number) => {
    const twoPi = Math.PI * 2;
    return ((rad % twoPi) + twoPi) % twoPi;
  };

  const toDegrees = (rad: number) => {
    let deg = (rad * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return deg;
  };

  const getBasketCenter = (a: Alliance): Vector2 => {
    return a === 'red' ? { x: 144, y: 0 } : { x: 0, y: 0 };
  };

  const calculateSuccess = (dist: number) => {
    const maxPossibleDist = 203.6; 
    const normalizedDist = dist / maxPossibleDist;
    const successChance = 1.0 - Math.pow(normalizedDist, 1.6) * 0.95;
    return Math.max(0.05, successChance);
  };

  const basketCenter = getBasketCenter(alliance);
  const distToGoal = Math.sqrt(Math.pow(basketCenter.x - robot.pos.x, 2) + Math.pow(basketCenter.y - robot.pos.y, 2));
  const currentSuccessProb = calculateSuccess(distToGoal);

  useEffect(() => {
    if (!isRunning) {
      r1Vel.current = { x: 0, y: 0 }; r1RotVel.current = 0;
      r2Vel.current = { x: 0, y: 0 }; r2RotVel.current = 0;
      (Object.values(pids.current.r1) as PIDController[]).forEach(p => p.reset());
      (Object.values(pids.current.r2) as PIDController[]).forEach(p => p.reset());
      setIsShootingMode(false);
    }
  }, [isRunning]);

  useEffect(() => {
    const updateSize = () => {
      const size = Math.min(window.innerWidth - 420, window.innerHeight - 150);
      setFieldWidth(Math.max(400, size));
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const isRunningRef = useRef(isRunning);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  
  const driveModeRef = useRef(driveMode);
  useEffect(() => { driveModeRef.current = driveMode; }, [driveMode]);

  const allianceRef = useRef(alliance);
  useEffect(() => { allianceRef.current = alliance; }, [alliance]);

  const isShootingModeRef = useRef(isShootingMode);
  useEffect(() => { isShootingModeRef.current = isShootingMode; }, [isShootingMode]);

  const partnerActiveRef = useRef(partnerActive);
  useEffect(() => { partnerActiveRef.current = partnerActive; }, [partnerActive]);

  useEffect(() => {
    let animationId: number;
    const loop = (time: number) => {
      const dt = Math.min((time - lastUpdateRef.current) / 1000, 0.05);
      lastUpdateRef.current = time;

      if (isRunningRef.current) {
        // Simulate odometry drift over time (realistic FTC conditions)
        const elapsedTime = (time - matchStartTime.current) / 1000; // seconds
        const driftRateX = -0.07; // inches per second drift left
        const driftRateY = 0.09; // inches per second drift up
        const driftRateHeading = 0.0015; // radians per second rotation drift
        
        setPositionDrift({
          x: elapsedTime * driftRateX,
          y: elapsedTime * driftRateY
        });
        setHeadingDrift(elapsedTime * driftRateHeading);
        
        setLaunchedSamples(current => {
           if (current.length === 0) return current;
           const nextList: LaunchedSample[] = [];
           current.forEach(ls => {
              const nextTime = (ls.timeElapsed || 0) + dt;
              // Use calculated flight time for smooth, realistic animation
              const flightTime = ls.flightTime || (ls.isScored ? 0.8 : 1.0);
              const nextT = Math.min(nextTime / flightTime, 1.0);
              if (nextT >= 1.0) {
                 if (ls.isScored) {
                    setScore(s => s + 3);
                    setLastShotResult('hit');
                    let respawnX = (ls.target.x > 72) ? 135 : 9;
                    let respawnY = 80 + Math.random() * 30;
                    setSamples(prev => [...prev, {
                        id: 'respawn-' + Math.random().toString(36),
                        pos: { x: respawnX, y: respawnY },
                        type: ls.type,
                        isPickedUp: false
                    }]);
                 } else {
                    setLastShotResult('miss');
                    setSamples(prev => [...prev, {
                        id: 'miss-' + Math.random().toString(36),
                        pos: ls.target,
                        type: ls.type,
                        isPickedUp: false
                    }]);
                 }
                 setTimeout(() => setLastShotResult(null), 1000);
              } else {
                 nextList.push({ ...ls, progress: nextT, timeElapsed: nextTime });
              }
           });
           return nextList;
        });

        

        const getPhysInput = (axes: number[], state: RobotState, vel: any, rot: any, p: any) => {
          const targetFwd = -axes[1] * MAX_SPEED;
          const targetStr = axes[0] * MAX_SPEED;
          const targetRot = axes[2] * MAX_ROT_SPEED;

          p.x.setTarget(targetStr);
          p.y.setTarget(targetFwd);
          p.h.setTarget(targetRot);

    

          vel.current.x += p.x.update(vel.current.x, dt) * dt;
          vel.current.y += p.y.update(vel.current.y, dt) * dt;
          rot.current += p.h.update(rot.current, dt) * dt;

          const h = state.heading;
          let world_dx = 0;
          let world_dy = 0;

          if (driveModeRef.current === 'robot') {
            world_dx = (vel.current.y * Math.cos(h) - vel.current.x * Math.sin(h)) * dt;
            world_dy = (vel.current.y * Math.sin(h) + vel.current.x * Math.cos(h)) * dt;
          } else {
            if (allianceRef.current === 'blue') {
              world_dx = vel.current.y * dt;
              world_dy = vel.current.x * dt;
            } else {
              world_dx = -vel.current.y * dt;
              world_dy = -vel.current.x * dt;
            }
          }
          return { world_dx, world_dy, nh: normalizeRadians(h + rot.current * dt) };
        };

        setRobot(currentRobot => {
          const axes = getAxes(0);
          const buttons = getButtons(0);
          const { world_dx, world_dy, nh } = getPhysInput(axes, currentRobot, r1Vel, r1RotVel, pids.current.r1);
          
          let nx = currentRobot.pos.x + world_dx;
          let ny = currentRobot.pos.y + world_dy;

          const mx = currentRobot.size.x / 2, my = currentRobot.size.y / 2;
          nx = Math.max(mx, Math.min(FIELD_SIZE_INCHES - mx, nx));
          ny = Math.max(my, Math.min(FIELD_SIZE_INCHES - my, ny));

          const basketSize = 24.5;
          const collisionBuffer = 10;
          const limit = basketSize + collisionBuffer;

          if (nx + ny < limit) { nx += (limit - (nx + ny)) * 0.5; ny += (limit - (nx + ny)) * 0.5; }
          if ((FIELD_SIZE_INCHES - nx) + ny < limit) { nx -= (limit - ((FIELD_SIZE_INCHES - nx) + ny)) * 0.5; ny += (limit - ((FIELD_SIZE_INCHES - nx) + ny)) * 0.5; }

          let nextRobot = { ...currentRobot, pos: { x: nx, y: ny }, heading: nh };
          
          if (buttons[4]) setIsShootingMode(true);
          if (buttons[0] || buttons[3]) setIsShootingMode(false);

          if (buttons[7]) { 
            if (isShootingModeRef.current) {
              if (nextRobot.heldSamples.length > 0 && !shootCooldownRef.current) {
                const shootingType = nextRobot.heldSamples.pop()!;
                const targetBasket = getBasketCenter(allianceRef.current);
                
                // Calculate accuracy based on distance - farther = lower accuracy
                const curDist = Math.sqrt(Math.pow(targetBasket.x - nextRobot.pos.x, 2) + Math.pow(targetBasket.y - nextRobot.pos.y, 2));
                const accuracyRate = calculateSuccess(curDist);
                const isScored = Math.random() < accuracyRate; // Probabilistic - based on distance
                
                let targetPos = { ...targetBasket };
                
                if (isScored) {
                  // Add slight variation to make it look natural
                  const noise = 4;
                  targetPos.x += (Math.random() - 0.5) * noise;
                  targetPos.y += (Math.random() - 0.5) * noise;
                } else {
                  // Bounce off the basket gate
                  const angleToCenter = Math.atan2(72 - targetBasket.y, 72 - targetBasket.x);
                  const bounceAngle = angleToCenter + (Math.random() - 0.5) * 1.2;
                  const bounceDist = 35 + Math.random() * 50;
                  targetPos = {
                    x: Math.max(20, Math.min(124, targetBasket.x + Math.cos(bounceAngle) * bounceDist)),
                    y: Math.max(20, Math.min(124, targetBasket.y + Math.sin(bounceAngle) * bounceDist))
                  };
                }

                // Calculate launch parameters for beautiful parabolic arc
                const dx = targetPos.x - nextRobot.pos.x;
                const dy = targetPos.y - nextRobot.pos.y;
                const distance = Math.sqrt(dx*dx + dy*dy);
                
                // Dynamic launch angle based on distance for optimal trajectory
                // Close shots: higher arc (looks better), far shots: flatter
                const optimalAngle = distance < 80 ? Math.PI / 3 : Math.PI / 4; // 60° close, 45° far
                const angleVariation = isScored ? 0.08 : 0.2;
                const launchAngle = optimalAngle + (Math.random() - 0.5) * angleVariation;
                
                const gravity = 120; // inches/s²
                // Calculate required speed for parabolic trajectory
                const sinTwoAlpha = Math.sin(2 * launchAngle);
                const baseSpeed = sinTwoAlpha > 0.1 ? Math.sqrt((distance * gravity) / sinTwoAlpha) : distance * 2;
                
                // Speed variation: scored shots are more consistent
                const speedVariation = isScored ? (0.98 + Math.random() * 0.04) : (0.8 + Math.random() * 0.3);
                const launchSpeed = baseSpeed * speedVariation;
                
                const aimAngle = Math.atan2(dy, dx);
                const velocity = {
                  x: Math.cos(aimAngle) * launchSpeed * Math.cos(launchAngle),
                  y: Math.sin(aimAngle) * launchSpeed * Math.cos(launchAngle)
                };
                
                // Calculate realistic flight time based on trajectory
                const verticalSpeed = launchSpeed * Math.sin(launchAngle);
                const flightTime = (2 * verticalSpeed) / gravity;

                setLaunchedSamples(prev => [...prev, {
                  id: Math.random().toString(36),
                  pos: { x: nextRobot.pos.x, y: nextRobot.pos.y },
                  target: targetPos,
                  type: shootingType,
                  progress: 0,
                  isScored,
                  velocity,
                  launchAngle,
                  timeElapsed: 0,
                  flightTime // Store for smooth animation
                }]);
              }
            } else { 
              if (nextRobot.heldSamples.length < 3 && !intakeCooldownRef.current) {
                setSamples(prevSamples => {
                  let pickedIdx = prevSamples.findIndex(s => !s.isPickedUp && Math.sqrt(Math.pow(s.pos.x - nextRobot.pos.x, 2) + Math.pow(s.pos.y - nextRobot.pos.y, 2)) < 8);
                  if (pickedIdx !== -1 && nextRobot.heldSamples.length < 3) {
                    nextRobot.heldSamples.push(prevSamples[pickedIdx].type);
                    intakeCooldownRef.current = true;
                    setTimeout(() => intakeCooldownRef.current = false, 250);
                    return prevSamples.filter((_, i) => i !== pickedIdx);
                  }
                  return prevSamples;
                });
              }
            }
          }
          // Apply drift to displayed position (odometry error simulation)
          nextRobot.pos.x += positionDrift.x;
          nextRobot.pos.y += positionDrift.y;
          nextRobot.heading += headingDrift;
          

          
          return nextRobot;
        });

        if (partnerActiveRef.current) {
          setPartner(currentPartner => {
            const axes = getAxes(1);
            const buttons = getButtons(1);
            const { world_dx, world_dy, nh } = getPhysInput(axes, currentPartner, r2Vel, r2RotVel, pids.current.r2);
            
            let nx = currentPartner.pos.x + world_dx;
            let ny = currentPartner.pos.y + world_dy;

            const mx = currentPartner.size.x / 2, my = currentPartner.size.y / 2;
            nx = Math.max(mx, Math.min(FIELD_SIZE_INCHES - mx, nx));
            ny = Math.max(my, Math.min(FIELD_SIZE_INCHES - my, ny));

            const basketSize = 24.5;
            const collisionBuffer = 10;
            const limit = basketSize + collisionBuffer;

            if (nx + ny < limit) { nx += (limit - (nx + ny)) * 0.5; ny += (limit - (nx + ny)) * 0.5; }
            if ((FIELD_SIZE_INCHES - nx) + ny < limit) { nx -= (limit - ((FIELD_SIZE_INCHES - nx) + ny)) * 0.5; ny += (limit - ((FIELD_SIZE_INCHES - nx) + ny)) * 0.5; }

            let nextPartner = { ...currentPartner, pos: { x: nx, y: ny }, heading: nh };

            if (buttons[7]) { 
              if (isShootingModeRef.current) {
                if (nextPartner.heldSamples.length > 0 && !partnerShootCooldownRef.current) {
                  const shootingType = nextPartner.heldSamples.pop()!;
                  const targetBasket = getBasketCenter(allianceRef.current);
                  
                  // Calculate accuracy based on distance - farther = lower accuracy
                  const curDist = Math.sqrt(Math.pow(targetBasket.x - nextPartner.pos.x, 2) + Math.pow(targetBasket.y - nextPartner.pos.y, 2));
                  const accuracyRate = calculateSuccess(curDist);
                  const isScored = Math.random() < accuracyRate; // Probabilistic - based on distance
                  
                  let targetPos = { ...targetBasket };
                  
                  if (isScored) {
                    // Add slight variation to make it look natural
                    const noise = 4;
                    targetPos.x += (Math.random() - 0.5) * noise;
                    targetPos.y += (Math.random() - 0.5) * noise;
                  } else {
                    // Bounce off the basket gate - calculate bounce position
                    const angleToCenter = Math.atan2(72 - targetBasket.y, 72 - targetBasket.x);
                    const bounceAngle = angleToCenter + (Math.random() - 0.5) * 1.2;
                    const bounceDist = 35 + Math.random() * 50;
                    targetPos = {
                      x: Math.max(20, Math.min(124, targetBasket.x + Math.cos(bounceAngle) * bounceDist)),
                      y: Math.max(20, Math.min(124, targetBasket.y + Math.sin(bounceAngle) * bounceDist))
                    };
                  }

                  // Calculate launch parameters for beautiful parabolic arc
                  const dx = targetPos.x - nextPartner.pos.x;
                  const dy = targetPos.y - nextPartner.pos.y;
                  const distance = Math.sqrt(dx*dx + dy*dy);
                  
                  // Dynamic launch angle based on distance
                  const optimalAngle = distance < 80 ? Math.PI / 3 : Math.PI / 4;
                  const angleVariation = isScored ? 0.08 : 0.2;
                  const launchAngle = optimalAngle + (Math.random() - 0.5) * angleVariation;
                  
                  const gravity = 120;
                  const sinTwoAlpha = Math.sin(2 * launchAngle);
                  const baseSpeed = sinTwoAlpha > 0.1 ? Math.sqrt((distance * gravity) / sinTwoAlpha) : distance * 2;
                  const speedVariation = isScored ? (0.98 + Math.random() * 0.04) : (0.8 + Math.random() * 0.3);
                  const launchSpeed = baseSpeed * speedVariation;
                  
                  const aimAngle = Math.atan2(dy, dx);
                  const velocity = {
                    x: Math.cos(aimAngle) * launchSpeed * Math.cos(launchAngle),
                    y: Math.sin(aimAngle) * launchSpeed * Math.cos(launchAngle)
                  };
                  
                  const verticalSpeed = launchSpeed * Math.sin(launchAngle);
                  const flightTime = (2 * verticalSpeed) / gravity;

                  setLaunchedSamples(prev => [...prev, {
                    id: Math.random().toString(36),
                    pos: { x: nextPartner.pos.x, y: nextPartner.pos.y },
                    target: targetPos,
                    type: shootingType,
                    progress: 0,
                    isScored,
                    velocity,
                    launchAngle,
                    timeElapsed: 0,
                    flightTime
                  }]);
                  partnerShootCooldownRef.current = true;
                  setTimeout(() => partnerShootCooldownRef.current = false, 350);
                }
              } else { 
                if (nextPartner.heldSamples.length < 3 && !partnerIntakeCooldownRef.current) {
                  setSamples(prevSamples => {
                    // Fix: Use nextPartner instead of nextRobot in partner robot logic
                    let pickedIdx = prevSamples.findIndex(s => !s.isPickedUp && Math.sqrt(Math.pow(s.pos.x - nextPartner.pos.x, 2) + Math.pow(s.pos.y - nextPartner.pos.y, 2)) < 8);
                    if (pickedIdx !== -1 && nextPartner.heldSamples.length < 3) {
                      nextPartner.heldSamples.push(prevSamples[pickedIdx].type);
                      partnerIntakeCooldownRef.current = true;
                      setTimeout(() => partnerIntakeCooldownRef.current = false, 250);
                      return prevSamples.filter((_, i) => i !== pickedIdx);
                    }
                    return prevSamples;
                  });
                }
              }
            }
            return nextPartner;
          });
        }

        if (partnerActiveRef.current) {
          setRobot(r => {
            setPartner(p => {
              const dx = r.pos.x - p.pos.x;
              const dy = r.pos.y - p.pos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const minDist = (r.size.x + p.size.x) / 1.8;
              
              if (dist < minDist && dist > 0.01) {
                const overlap = (minDist - dist) * 0.5;
                const pushX = (dx / dist) * overlap;
                const pushY = (dy / dist) * overlap;
                
                r.pos.x += pushX;
                r.pos.y += pushY;
                p.pos.x -= pushX;
                p.pos.y -= pushY;
              }
              return { ...p };
            });
            return { ...r };
          });
        }
      }
      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, []);

  const resetField = () => {
    setSamples(INITIAL_SAMPLES);
    setLaunchedSamples([]);
    setScore(0);
    setIsShootingMode(false);
    setLastShotResult(null);
    setRobot(r => ({ ...r, heldSamples: [] }));
    setPartner(p => ({ ...p, heldSamples: [] }));
  };
  
  const relocalize = () => {
    // Reset odometry drift when robot is in Human Player corner
    const hpCorner = alliance === 'red' ? { x: 120, y: 120 } : { x: 24, y: 120 };
    const distToCorner = Math.sqrt(
      Math.pow(robot.pos.x - positionDrift.x - hpCorner.x, 2) + 
      Math.pow(robot.pos.y - positionDrift.y - hpCorner.y, 2)
    );
    
    if (distToCorner < 20) {
      setPositionDrift({ x: 0, y: 0 });
      setHeadingDrift(0);
      matchStartTime.current = performance.now();
    }
  };

  const startMatch = (chosenAlliance: Alliance) => {
    setAlliance(chosenAlliance);
    setIsRunning(true);
    resetField();
    
    // Reset drift simulation
    setPositionDrift({ x: 0, y: 0 });
    setHeadingDrift(0);
    matchStartTime.current = performance.now();
    const spawnX = chosenAlliance === 'red' ? 120 : 24;
    setRobot(prev => ({
        ...prev,
        pos: { x: spawnX, y: 120 },
        heading: -Math.PI / 2
    }));
    if (partnerActive) {
      setPartner(prev => ({
        ...prev,
        pos: { x: spawnX + (chosenAlliance === 'red' ? -24 : 24), y: 120 },
        heading: -Math.PI / 2
      }));
    }
  };

  return (
    <div className="flex h-screen bg-[#020202] text-white overflow-hidden font-sans select-none">
      <aside className="w-80 border-r border-white/5 bg-[#080808] flex flex-col p-6 gap-6 z-20 shadow-2xl overflow-y-auto no-scrollbar">
        <div>
          <h1 className="text-3xl font-black italic tracking-tighter text-white flex items-center gap-2">
            <span className={`w-2 h-8 ${isRunning ? allianceBgColor : 'bg-purple-600'} rounded-full`}></span>
            NEURA<span className={isRunning ? allianceThemeColor : 'text-purple-500'}>VIZ</span>
          </h1>
          <p className="text-[10px] font-mono text-neutral-500 mt-2 uppercase tracking-widest leading-relaxed">
            L1: ARM (SHOOT) | R2: ACTION
          </p>
        </div>

        {isRunning && (
          <div className="bg-neutral-900/90 backdrop-blur-xl p-6 rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-white/5"></div>
             <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">{alliance.toUpperCase()} MATCH SCORE</span>
             <span className={`text-6xl font-black italic tabular-nums leading-none ${allianceThemeColor}`}>{score}</span>
             
             {lastShotResult && (
               <div className={`mt-4 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest animate-bounce ${lastShotResult === 'hit' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                 {lastShotResult === 'hit' ? 'TARGET HIT!' : 'MISSED! BOUNCE'}
               </div>
             )}
          </div>
        )}

        {isRunning && (
          <div className="flex flex-col gap-2">
            <div className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all bg-black/40 border-white/5`}>
               <span className="text-[10px] font-bold text-neutral-500 uppercase">Drive System</span>
               <span className="text-[10px] font-black uppercase text-white bg-white/10 px-2 py-0.5 rounded">{driveMode}-CENTRIC</span>
            </div>
            <div className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all ${isShootingMode ? 'bg-red-500/10 border-red-500/50' : 'bg-green-500/10 border-green-500/50'}`}>
               <span className="text-[10px] font-bold text-neutral-400 uppercase">Active Mode</span>
               <span className={`text-[10px] font-black uppercase ${isShootingMode ? 'text-red-400' : 'text-green-400'}`}>{isShootingMode ? 'ARMED' : 'INTAKE'}</span>
            </div>
            
            {/* Odometry Drift Indicator */}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                <span className="text-[9px] font-bold text-yellow-400 uppercase">Drift Error</span>
              </div>
              <div className="space-y-0.5 text-[8px] font-mono text-yellow-200/80">
                <div>X: {positionDrift.x.toFixed(1)}"</div>
                <div>Y: {positionDrift.y.toFixed(1)}"</div>
                <div>θ: {(headingDrift * 180 / Math.PI).toFixed(1)}°</div>
              </div>
            </div>
            
            {/* Relocalization Button */}
            <button
              onClick={relocalize}
              className={`w-full py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                (() => {
                  const hpCorner = alliance === 'red' ? { x: 120, y: 120 } : { x: 24, y: 120 };
                  const distToCorner = Math.sqrt(
                    Math.pow(robot.pos.x - positionDrift.x - hpCorner.x, 2) + 
                    Math.pow(robot.pos.y - positionDrift.y - hpCorner.y, 2)
                  );
                  return distToCorner < 20 
                    ? 'bg-green-600 hover:bg-green-500 shadow-lg shadow-green-600/30 hover:scale-105' 
                    : 'bg-neutral-800 opacity-50 cursor-not-allowed';
                })()
              }`}
            >
              🎯 RELOCALIZE
            </button>
          </div>
        )}

        {isRunning ? (
          <button 
            onClick={() => setIsRunning(false)}
            className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-xl bg-red-600 shadow-red-600/20"
          >
            STOP MATCH
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => startMatch('red')}
              className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-xl bg-red-600 shadow-red-600/30 hover:scale-105 active:scale-95"
            >
              START RED ALLIANCE
            </button>
            <button 
              onClick={() => startMatch('blue')}
              className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-xl bg-blue-600 shadow-blue-600/30 hover:scale-105 active:scale-95"
            >
              START BLUE ALLIANCE
            </button>
          </div>
        )}

        <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 space-y-4">
             <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-[10px] font-bold uppercase text-neutral-400">Match Settings</span>
             </div>
             <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-neutral-500 uppercase">Alliance Partner</span>
                <button 
                  onClick={() => setPartnerActive(!partnerActive)}
                  className={`w-10 h-5 rounded-full transition-all relative ${partnerActive ? allianceBgColor : 'bg-neutral-700'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${partnerActive ? 'left-6' : 'left-1'}`}></div>
                </button>
             </div>
             <p className="text-[8px] font-mono text-neutral-600 uppercase">Partner controllable via Gamepad 2</p>
        </div>

        {isRunning && (
          <div className="bg-neutral-900/60 p-4 rounded-xl border border-white/10 space-y-2">
             <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400 uppercase">
                <span>Distance to Goal</span>
                <span className="text-white font-mono">{distToGoal.toFixed(1)}"</span>
             </div>
             <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400 uppercase">
                <span>Shot Accuracy</span>
                <span className={`${currentSuccessProb > 0.8 ? 'text-blue-400' : currentSuccessProb > 0.6 ? 'text-green-500' : currentSuccessProb > 0.35 ? 'text-yellow-500' : 'text-red-500'} font-black`}>
                  {(currentSuccessProb * 100).toFixed(0)}%
                </span>
             </div>
             <div className="w-full h-1 bg-neutral-800 rounded-full mt-2 overflow-hidden">
                <div 
                   className={`h-full ${currentSuccessProb > 0.8 ? 'bg-blue-400' : currentSuccessProb > 0.6 ? 'bg-green-500' : currentSuccessProb > 0.35 ? 'bg-yellow-500' : 'bg-red-500'}`}
                   style={{ width: `${currentSuccessProb * 100}%` }}
                ></div>
             </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 space-y-4">
             <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <div className={`w-2 h-2 rounded-full ${isRunning ? allianceBgColor : 'bg-purple-500'}`}></div>
                <span className="text-[10px] font-bold uppercase text-neutral-400">Robot Settings</span>
             </div>
             <div className="grid grid-cols-2 gap-3">
                <ConfigInput label="Width" value={robot.size.x} min={10} max={24} step={0.1} suffix='"' onChange={v => setRobot(p => ({...p, size: {...p.size, x: v}}))} />
                <ConfigInput label="Height" value={robot.size.y} min={10} max={24} step={0.1} suffix='"' onChange={v => setRobot(p => ({...p, size: {...p.size, y: v}}))} />
             </div>
             <div className="grid grid-cols-2 gap-3 pt-2">
                <ConfigInput label="X Pos" value={robot.pos.x} min={0} max={144} step={0.5} suffix='"' onChange={v => setRobot(p => ({...p, pos: {...p.pos, x: v}}))} />
                <ConfigInput label="Y Pos" value={robot.pos.y} min={0} max={144} step={0.5} suffix='"' onChange={v => setRobot(p => ({...p, pos: {...p.pos, y: v}}))} />
             </div>
             <ConfigInput label="Heading" value={toDegrees(robot.heading)} min={0} max={360} step={1} suffix="°" onChange={v => setRobot(p => ({...p, heading: normalizeRadians(v * Math.PI / 180)}))} />
          </div>

          <div className={`bg-neutral-900/40 p-4 rounded-xl border border-white/5 space-y-4 transition-all ${!partnerActive ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
             <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <div className={`w-2 h-2 rounded-full ${isRunning && partnerActive ? (alliance === 'red' ? 'bg-red-500' : 'bg-blue-500') : 'bg-neutral-600'}`}></div>
                <span className="text-[10px] font-bold uppercase text-neutral-400">Partner Settings</span>
             </div>
             <div className="grid grid-cols-2 gap-3">
                <ConfigInput label="Width" value={partner.size.x} min={10} max={24} step={0.1} suffix='"' onChange={v => setPartner(p => ({...p, size: {...p.size, x: v}}))} />
                <ConfigInput label="Height" value={partner.size.y} min={10} max={24} step={0.1} suffix='"' onChange={v => setPartner(p => ({...p, size: {...p.size, y: v}}))} />
             </div>
             <div className="grid grid-cols-2 gap-3 pt-2">
                <ConfigInput label="X Pos" value={partner.pos.x} min={0} max={144} step={0.5} suffix='"' onChange={v => setPartner(p => ({...p, pos: {...p.pos, x: v}}))} />
                <ConfigInput label="Y Pos" value={partner.pos.y} min={0} max={144} step={0.5} suffix='"' onChange={v => setPartner(p => ({...p, pos: {...p.pos, y: v}}))} />
             </div>
             <ConfigInput label="Heading" value={toDegrees(partner.heading)} min={0} max={360} step={1} suffix="°" onChange={v => setPartner(p => ({...p, heading: normalizeRadians(v * Math.PI / 180)}))} />
          </div>
        </div>

        <div className="mt-auto space-y-4">
          <div className="grid grid-cols-2 gap-2 bg-black p-1 rounded-lg border border-white/10">
            <button onClick={() => setDriveMode('field')} className={`py-2 text-[10px] font-bold rounded transition-all ${driveMode === 'field' ? (isRunning ? allianceBgColor : 'bg-purple-600') + ' text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-400'}`}>FIELD</button>
            <button onClick={() => setDriveMode('robot')} className={`py-2 text-[10px] font-bold rounded transition-all ${driveMode === 'robot' ? (isRunning ? allianceBgColor : 'bg-purple-600') + ' text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-400'}`}>ROBOT</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col items-center justify-center p-12 bg-[#020202] relative">
        <div className={`absolute inset-0 ${isRunning && alliance === 'red' ? 'bg-[radial-gradient(circle_at_center,_rgba(220,38,38,0.02)_0%,_transparent_70%)]' : 'bg-[radial-gradient(circle_at_center,_rgba(37,99,235,0.02)_0%,_transparent_70%)]'} pointer-events-none`}></div>
        <div className="relative">
          <Field 
            robot={robot} 
            width={fieldWidth} 
            height={fieldWidth} 
            samples={samples} 
            launchedSamples={launchedSamples} 
            alliancePartner={partnerActive ? partner : undefined} 
          />
          
          {isRunning && (
            <>
              {/* Drift Warning Overlay */}
              {(Math.abs(positionDrift.x) > 3 || Math.abs(positionDrift.y) > 3) && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500/20 backdrop-blur-md border border-yellow-500/50 px-4 py-2 rounded-xl pointer-events-none">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 text-lg">⚠️</span>
                    <span className="text-yellow-200 font-bold text-sm uppercase">Odometry Drift Detected</span>
                  </div>
                  <p className="text-yellow-300/70 text-xs text-center mt-1">Drive to HP corner and relocalize</p>
                </div>
              )}
              
              {/* Bottom HUD - Small and Non-obstructive */}
              <div className="absolute bottom-4 left-4 flex gap-2 pointer-events-none">
                <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5 flex flex-col gap-0.5">
                  <span className="text-[7px] font-bold text-neutral-500 uppercase tracking-tighter">System HUD</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[9px] font-black text-white uppercase">{driveMode}</span>
                    <span className="w-1 h-1 rounded-full bg-neutral-600"></span>
                    <span className={`text-[9px] font-black uppercase ${isShootingMode ? 'text-red-400' : 'text-green-400'}`}>
                      {isShootingMode ? 'ARMED' : 'INTAKE'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-4 right-4 pointer-events-none">
                <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5 flex flex-col items-end">
                  <span className="text-[7px] font-bold text-neutral-500 uppercase tracking-tighter">{alliance} SCORE</span>
                  <span className={`text-xl font-black italic tabular-nums leading-none ${allianceThemeColor}`}>{score}</span>
                </div>
              </div>
            </>
          )}

          {!isRunning && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center rounded-2xl border border-white/5 z-30 transition-all p-8 text-center">
              <h2 className="text-6xl font-black italic tracking-tighter mb-2 text-white uppercase">NEURA VIZ</h2>
              <p className="text-neutral-400 font-mono text-[10px] uppercase mb-8 tracking-[0.3em]">Select Alliance to Begin</p>
              
              <div className="flex gap-8 w-full max-w-2xl">
                <button 
                  onClick={() => startMatch('red')} 
                  className="flex-1 group relative overflow-hidden bg-red-600/10 border-2 border-red-600/50 rounded-3xl p-8 hover:bg-red-600/20 transition-all hover:scale-105 active:scale-95"
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                  <span className="text-4xl font-black italic text-red-500 group-hover:text-red-400 uppercase">RED</span>
                  <p className="text-[10px] text-red-300/50 mt-2 font-mono">SIDE VIEW CONTROLS (X=144)</p>
                </button>
                
                <button 
                  onClick={() => startMatch('blue')} 
                  className="flex-1 group relative overflow-hidden bg-blue-600/10 border-2 border-blue-600/50 rounded-3xl p-8 hover:bg-blue-600/20 transition-all hover:scale-105 active:scale-95"
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-blue-600"></div>
                  <span className="text-4xl font-black italic text-blue-500 group-hover:text-blue-400 uppercase">BLUE</span>
                  <p className="text-[10px] text-blue-300/50 mt-2 font-mono">SIDE VIEW CONTROLS (X=0)</p>
                </button>
              </div>

              <div className="mt-12 text-neutral-500 text-[10px] font-mono flex gap-8">
                 <span>WASD: MOVE</span>
                 <span>L1: ARM SHOOT</span>
                 <span>△/X: DISARM</span>
                 <span>R2: ACTION</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
