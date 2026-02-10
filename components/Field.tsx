
import React, { useRef, useEffect, useState } from 'react';
import { RobotState, Vector2, Sample, LaunchedSample, Alliance } from '../types';
import { FIELD_SIZE_INCHES } from '../constants';

interface FieldProps {
  robot: RobotState;
  width: number;
  height: number;
  samples: Sample[];
  launchedSamples: LaunchedSample[];
  alliancePartner?: RobotState;
  isShootingMode: boolean;
  alliance: Alliance;
}

const FIELD_IMAGE_URL = 'https://visualizer.pedropathing.com/fields/decode.webp';
const ROBOT_IMAGE_URL = 'https://visualizer.pedropathing.com/robot.png';

const Field: React.FC<FieldProps> = ({ robot, width, height, samples, launchedSamples, alliancePartner, isShootingMode, alliance }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<{ field: HTMLImageElement | null, robot: HTMLImageElement | null }>({ field: null, robot: null });
  const [history, setHistory] = useState<Vector2[]>([]);
  
  const scale = width / FIELD_SIZE_INCHES;
  const toPx = (inches: number) => inches * scale;

  // Color helper
  const getSampleColor = (type: string) => {
    switch(type) {
      case 'green': return '#22c55e';
      case 'purple': return '#a855f7';
      case 'yellow': return '#eab308';
      default: return '#ffffff';
    }
  };

  useEffect(() => {
    const fImg = new Image();
    const rImg = new Image();
    fImg.src = FIELD_IMAGE_URL;
    rImg.src = ROBOT_IMAGE_URL;
    fImg.onload = () => setImages(prev => ({ ...prev, field: fImg }));
    rImg.onload = () => setImages(prev => ({ ...prev, robot: rImg }));
  }, []);

  useEffect(() => {
    setHistory(prev => [robot.pos, ...prev].slice(0, 50));
  }, [robot.pos.x, robot.pos.y]);

  // Helper function to transform coordinates based on alliance
  const transformCoord = (x: number, y: number) => {
    if (alliance === 'red') {
      // Flip field for red alliance (180 degree rotation)
      return { x: width - x, y: height - y };
    }
    return { x, y };
  };

  const transformRobotHeading = (heading: number) => {
    if (alliance === 'red') {
      return heading + Math.PI;
    }
    return heading;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Apply field transformation for red alliance
    if (alliance === 'red') {
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
    }

    if (images.field) {
      ctx.drawImage(images.field, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
    }

    // Draw Static "Solid" Corner Baskets
    const basketSizePx = toPx(24.5);
    
    // Blue Basket (Top Left for blue alliance, top right for red alliance)
    ctx.save();
    const blueBasketPos = alliance === 'blue' 
      ? { x: 0, y: 0 } 
      : { x: width - basketSizePx, y: height - basketSizePx };
    ctx.beginPath();
    ctx.rect(blueBasketPos.x, blueBasketPos.y, basketSizePx, basketSizePx);
    ctx.fillStyle = (isShootingMode && alliance === 'blue') ? 'rgba(37, 99, 235, 0.4)' : 'rgba(37, 99, 235, 0.1)';
    ctx.fill();
    ctx.lineWidth = (isShootingMode && alliance === 'blue') ? 6 : 4;
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.8)';
    ctx.stroke();
    
    // Net pattern
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.3)';
    for(let i=0; i<basketSizePx; i+=toPx(4)) {
        ctx.moveTo(blueBasketPos.x + i, blueBasketPos.y); ctx.lineTo(blueBasketPos.x + i, blueBasketPos.y + basketSizePx);
        ctx.moveTo(blueBasketPos.x, blueBasketPos.y + i); ctx.lineTo(blueBasketPos.x + basketSizePx, blueBasketPos.y + i);
    }
    ctx.stroke();
    ctx.restore();

    // Red Basket (Top Right for blue alliance, top left for red alliance)
    ctx.save();
    const redBasketPos = alliance === 'blue' 
      ? { x: width - basketSizePx, y: 0 } 
      : { x: 0, y: height - basketSizePx };
    ctx.beginPath();
    ctx.rect(redBasketPos.x, redBasketPos.y, basketSizePx, basketSizePx);
    ctx.fillStyle = (isShootingMode && alliance === 'red') ? 'rgba(220, 38, 38, 0.4)' : 'rgba(220, 38, 38, 0.1)';
    ctx.fill();
    ctx.lineWidth = (isShootingMode && alliance === 'red') ? 6 : 4;
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.8)';
    ctx.stroke();

    // Net pattern
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.3)';
    for(let i=0; i<basketSizePx; i+=toPx(4)) {
        ctx.moveTo(redBasketPos.x + i, redBasketPos.y); ctx.lineTo(redBasketPos.x + i, redBasketPos.y + basketSizePx);
        ctx.moveTo(redBasketPos.x, redBasketPos.y + i); ctx.lineTo(redBasketPos.x + basketSizePx, redBasketPos.y + i);
    }
    ctx.stroke();
    ctx.restore();

    samples.forEach(sample => {
      if (sample.isPickedUp) return;
      const pos = transformCoord(toPx(sample.pos.x), toPx(sample.pos.y));
      const px = pos.x;
      const py = pos.y;
      const radius = toPx(2);
      ctx.save();
      ctx.shadowBlur = 10;
      const col = getSampleColor(sample.type);
      ctx.shadowColor = col;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    });

    launchedSamples.forEach(ls => {
      const startPos = transformCoord(toPx(ls.pos.x), toPx(ls.pos.y));
      const startX = startPos.x;
      const startY = startPos.y;
      const t = ls.progress;
      const time = ls.timeElapsed || 0;
      
      let x, y, z = 0; // z is vertical height
      let vx_current = 0, vy_current = 0; // Current velocity for motion blur
      
      if (ls.velocity && ls.launchAngle !== undefined) {
        // Realistic parabolic trajectory with gravity
        const gravity = 120; // inches per second squared
        const scaledGravity = gravity * scale; // convert to pixels
        
        // Calculate position using physics equations
        const vx = alliance === 'red' ? -ls.velocity.x : ls.velocity.x;
        const vy = alliance === 'red' ? -ls.velocity.y : ls.velocity.y;
        const vz = Math.sin(ls.launchAngle) * Math.sqrt(vx*vx + vy*vy); // vertical velocity component
        
        if (ls.isScored) {
          // Perfect arc trajectory to target
          const targetPos = transformCoord(toPx(ls.target.x), toPx(ls.target.y));
          const endX = targetPos.x;
          const endY = targetPos.y;
          const dx = endX - startX;
          const dy = endY - startY;
          
          // Smooth bezier curve for realistic arc
          const controlHeight = toPx(40) + Math.sqrt(dx*dx + dy*dy) * 0.3;
          const cx = startX + dx * 0.5;
          const cy = startY + dy * 0.5 - controlHeight;
          
          // Quadratic bezier
          const mt = 1 - t;
          x = mt * mt * startX + 2 * mt * t * cx + t * t * endX;
          y = mt * mt * startY + 2 * mt * t * cy + t * t * endY;
          
          // Height follows physics
          z = Math.max(0, vz * time * scale - 0.5 * scaledGravity * time * time);
          
          // Calculate velocity for motion blur
          vx_current = vx * scale;
          vy_current = vy * scale;
        } else {
          // Miss trajectory - aggressive overshoot then drop
          const targetX = alliance === 'red' ? (ls.target.x > 72 ? 0 : width) : (ls.target.x > 72 ? width : 0);
          const targetY = 0;
          const basketX = targetX;
          const basketY = targetY;
          
          if (t < 0.65) {
            // Flying toward basket with arc
            const nt = t / 0.65;
            const dx = basketX - startX;
            const dy = basketY - startY;
            const controlHeight = toPx(45) + Math.sqrt(dx*dx + dy*dy) * 0.35;
            const cx = startX + dx * 0.5;
            const cy = startY + dy * 0.5 - controlHeight;
            
            const mt = 1 - nt;
            x = mt * mt * startX + 2 * mt * nt * cx + nt * nt * basketX;
            y = mt * mt * startY + 2 * mt * nt * cy + nt * nt * basketY;
            z = Math.max(0, vz * time * scale - 0.5 * scaledGravity * time * time);
            
            vx_current = vx * scale * (1 - nt);
            vy_current = vy * scale * (1 - nt);
          } else {
            // Bounce/ricochet off basket
            const bounceStart = 0.65;
            const bounceProgress = (t - bounceStart) / (1 - bounceStart);
            const targetPos = transformCoord(toPx(ls.target.x), toPx(ls.target.y));
            const endX = targetPos.x;
            const endY = targetPos.y;
            
            // Bounce trajectory
            const bounceHeight = toPx(15) * (1 - bounceProgress);
            x = basketX + (endX - basketX) * bounceProgress;
            y = basketY + (endY - basketY) * bounceProgress;
            z = Math.max(0, bounceHeight * Math.sin(Math.PI * bounceProgress));
            
            vx_current = (endX - basketX) * 0.8;
            vy_current = (endY - basketY) * 0.8;
          }
        }
      } else {
        // Fallback for old samples without velocity data
        const targetPos = transformCoord(toPx(ls.target.x), toPx(ls.target.y));
        const endX = targetPos.x;
        const endY = targetPos.y;
        x = startX + (endX - startX) * t;
        y = startY + (endY - startY) * t;
        z = toPx(25) * Math.sin(Math.PI * t);
      }
      
      const arcHeight = Math.max(0, z);
      const baseRadius = toPx(2.5);
      // Size variation based on height (perspective)
      const heightFactor = 1 + (arcHeight / toPx(50)) * 0.4;
      const radius = baseRadius * heightFactor;
      
      const col = getSampleColor(ls.type);
      
      // Draw shadow on ground (looks amazing!)
      if (arcHeight > 2) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.4, arcHeight / toPx(60));
        ctx.translate(x + arcHeight * 0.2, y + arcHeight * 0.15);
        const shadowRadius = radius * (1 + arcHeight / toPx(40));
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowRadius);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, shadowRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // Draw motion trail (streak effect)
      if (t > 0.1 && t < 0.9) {
        ctx.save();
        const trailLength = 5;
        for (let i = 1; i <= trailLength; i++) {
          const trailT = Math.max(0, t - i * 0.015);
          const trailAlpha = (1 - i / trailLength) * 0.3;
          
          let tx, ty, tz;
          if (ls.velocity && ls.launchAngle !== undefined) {
            const vz = Math.sin(ls.launchAngle) * Math.sqrt(ls.velocity.x**2 + ls.velocity.y**2);
            const scaledGravity = 120 * scale;
            const trailTime = trailT * (ls.isScored ? 0.8 : 1.0);
            
            if (ls.isScored) {
              const endX = toPx(ls.target.x);
              const endY = toPx(ls.target.y);
              const dx = endX - startX;
              const dy = endY - startY;
              const controlHeight = toPx(40) + Math.sqrt(dx*dx + dy*dy) * 0.3;
              const cx = startX + dx * 0.5;
              const cy = startY + dy * 0.5 - controlHeight;
              const mt = 1 - trailT;
              tx = mt * mt * startX + 2 * mt * trailT * cx + trailT * trailT * endX;
              ty = mt * mt * startY + 2 * mt * trailT * cy + trailT * trailT * endY;
              tz = Math.max(0, vz * trailTime * scale - 0.5 * scaledGravity * trailTime * trailTime);
            } else {
              tx = x - vx_current * i * 0.015;
              ty = y - vy_current * i * 0.015;
              tz = arcHeight;
            }
          } else {
            tx = x - (x - startX) * 0.05 * i;
            ty = y - (y - startY) * 0.05 * i;
            tz = arcHeight;
          }
          
          ctx.globalAlpha = trailAlpha;
          ctx.translate(tx, ty - tz);
          ctx.shadowBlur = 15;
          ctx.shadowColor = col;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        ctx.restore();
      }

      // Draw main ball with rotation
      ctx.save();
      ctx.translate(x, y - arcHeight);
      
      // Rotation based on travel distance
      const rotationSpeed = 8;
      const rotation = t * Math.PI * rotationSpeed;
      ctx.rotate(rotation);
      
      // Outer glow
      ctx.shadowBlur = 30 + arcHeight / 8;
      ctx.shadowColor = col;
      
      // Create gradient for 3D sphere effect
      const gradient = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, 0, 0, 0, radius);
      gradient.addColorStop(0, col.replace('rgb', 'rgba').replace(')', ', 0.9)'));
      gradient.addColorStop(0.6, col);
      gradient.addColorStop(1, col.replace('rgb', 'rgba').replace(')', ', 0.6)'));
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Highlight (shine effect)
      const highlightGrad = ctx.createRadialGradient(-radius * 0.4, -radius * 0.4, 0, -radius * 0.4, -radius * 0.4, radius * 0.6);
      highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = highlightGrad;
      ctx.beginPath();
      ctx.arc(-radius * 0.3, -radius * 0.3, radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
      
      // Seam lines for realistic ball texture
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
    });

    if (history.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
      ctx.lineWidth = 2;
      const startPos = transformCoord(toPx(history[0].x), toPx(history[0].y));
      ctx.moveTo(startPos.x, startPos.y);
      for (let i = 1; i < history.length; i++) {
        const pos = transformCoord(toPx(history[i].x), toPx(history[i].y));
        ctx.lineTo(pos.x, pos.y);
      }
      ctx.stroke();
    }

    const drawRobot = (state: RobotState, isPartner: boolean) => {
      ctx.save();
      const pos = transformCoord(toPx(state.pos.x), toPx(state.pos.y));
      ctx.translate(pos.x, pos.y);
      ctx.rotate(transformRobotHeading(state.heading));
      const rw = toPx(state.size.x);
      const rh = toPx(state.size.y);

      // Draw Intake Visualization
      if (state.intakeActive) {
        ctx.save();
        // Move to front of robot
        ctx.translate(rw / 2, 0);
        
        // Spinning "Suction" Effect
        const time = performance.now() / 50;
        
        // Cone of influence
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, toPx(18), -Math.PI / 4, Math.PI / 4);
        ctx.lineTo(0,0);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        
        // Active Rollers / Lines
        ctx.lineWidth = 2;
        ctx.strokeStyle = isPartner ? 'rgba(59, 130, 246, 0.6)' : 'rgba(168, 85, 247, 0.6)';
        
        for (let i = 0; i < 3; i++) {
           ctx.beginPath();
           const offset = (time + i * 2) % 6;
           const x = offset * toPx(2);
           const yScale = 1 - (offset / 6);
           ctx.moveTo(x, -toPx(6) * yScale);
           ctx.bezierCurveTo(x - toPx(2), 0, x - toPx(2), 0, x, toPx(6) * yScale);
           ctx.stroke();
        }
        ctx.restore();
      }

      if (images.robot) {
        if (isPartner) ctx.filter = 'hue-rotate(200deg) saturate(1.4)';
        ctx.drawImage(images.robot, -rw/2, -rh/2, rw, rh);
        ctx.filter = 'none';
      } else {
        ctx.fillStyle = isPartner ? '#2563eb' : '#8b5cf6';
        ctx.fillRect(-rw/2, -rh/2, rw, rh);
      }

      // Draw Held Samples ON TOP of robot image
      if (state.heldSamples.length > 0) {
         const sRadius = rw * 0.18;
         
         state.heldSamples.forEach((type, idx) => {
           ctx.save();
           const offset = (idx - (state.heldSamples.length - 1) / 2) * (sRadius * 2.4);
           ctx.translate(offset, 0);

           const col = getSampleColor(type);
           
           // Background glow
           ctx.shadowBlur = 20;
           ctx.shadowColor = col;
           
           // Draw circle
           ctx.beginPath();
           ctx.arc(0, 0, sRadius, 0, Math.PI * 2);
           ctx.fillStyle = col;
           ctx.fill();
           
           // Strong black outline for contrast
           ctx.shadowBlur = 0;
           ctx.lineWidth = 4;
           ctx.strokeStyle = '#000000';
           ctx.stroke();
           
           // Inner highlight
           ctx.beginPath();
           ctx.arc(-sRadius * 0.3, -sRadius * 0.3, sRadius * 0.3, 0, Math.PI * 2);
           ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
           ctx.fill();
           
           ctx.restore();
         });
      }

      ctx.restore();
    };

    if (alliancePartner) drawRobot(alliancePartner, true);
    drawRobot(robot, false);

    // Restore context from alliance transformation
    ctx.restore();

  }, [robot, width, height, images, history, alliancePartner, samples, launchedSamples, alliance]);

  return (
    <div className="rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10 bg-neutral-900">
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
};

export default Field;
