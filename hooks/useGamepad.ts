
import { useState, useEffect, useRef } from 'react';

export const useGamepad = () => {
  const [connectedCount, setConnectedCount] = useState(0);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const axesRef = useRef<number[][]>([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
  const buttonsRef = useRef<boolean[][]>([new Array(16).fill(false), new Array(16).fill(false)]);
  const internalKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (document.activeElement?.tagName === 'INPUT') return;
      internalKeys.current.add(key);
      setActiveKeys(new Set(internalKeys.current));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      internalKeys.current.delete(e.key.toLowerCase());
      setActiveKeys(new Set(internalKeys.current));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    let animationId: number;
    const poll = () => {
      const gamepads = navigator.getGamepads();
      const newAxes = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
      const newButtons = [new Array(16).fill(false), new Array(16).fill(false)];
      const deadzone = 0.15;
      
      let foundGamepads = 0;
      let connectedTotal = 0;

      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected) {
          connectedTotal++;
          if (foundGamepads < 2) {
            for (let j = 0; j < Math.min(gp.axes.length, 6); j++) {
              newAxes[foundGamepads][j] = Math.abs(gp.axes[j]) > deadzone ? gp.axes[j] : 0;
            }
            for (let j = 0; j < Math.min(gp.buttons.length, 16); j++) {
              newButtons[foundGamepads][j] = gp.buttons[j].pressed;
            }
            foundGamepads++;
          }
        }
      }

      // Keyboard Fallback for Player 1
      if (foundGamepads === 0 || (foundGamepads > 0 && Math.abs(newAxes[0][0]) < 0.01 && Math.abs(newAxes[0][1]) < 0.01)) {
        if (internalKeys.current.has('w')) newAxes[0][1] = -1;
        if (internalKeys.current.has('s')) newAxes[0][1] = 1;
        if (internalKeys.current.has('a')) newAxes[0][0] = -1;
        if (internalKeys.current.has('d')) newAxes[0][0] = 1;
        if (internalKeys.current.has('q')) newAxes[0][2] = -1;
        if (internalKeys.current.has('e')) newAxes[0][2] = 1;
        
        // R2 (Button 7) fallback: space / r
        if (internalKeys.current.has('r') || internalKeys.current.has(' ')) newButtons[0][7] = true;
        
        // L1 (Button 4) fallback: '1' or 'l'
        if (internalKeys.current.has('1') || internalKeys.current.has('l')) newButtons[0][4] = true;
        
        // X button (Button 0 or 2) fallback: 'x' or '3'
        if (internalKeys.current.has('x') || internalKeys.current.has('3')) {
           newButtons[0][0] = true;
           newButtons[0][2] = true; // Support both PS/Xbox X locations
        }
      }

      axesRef.current = newAxes;
      buttonsRef.current = newButtons;
      if (connectedTotal !== connectedCount) setConnectedCount(connectedTotal);
      animationId = requestAnimationFrame(poll);
    };

    animationId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animationId);
  }, [connectedCount]);

  return {
    connectedCount,
    activeKeys,
    getAxes: (player: number) => axesRef.current[player] || [0, 0, 0, 0, 0, 0],
    getButtons: (player: number) => buttonsRef.current[player] || new Array(16).fill(false)
  };
};
