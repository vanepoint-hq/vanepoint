// Transparent, click-through overlay on the primary display: laser dot, spotlight and dial HUD.
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type OverlayEvent =
  | { kind: 'laser'; active: boolean; x: number; y: number; style: string }
  | { kind: 'dial'; deltaRad: number; detents: number }
  | { kind: 'profile'; name: string | null };

function Overlay() {
  const [laser, setLaser] = useState<{ x: number; y: number; style: string } | null>(null);
  const [fading, setFading] = useState(false);
  const [dial, setDial] = useState<{ total: number; visible: boolean }>({ total: 0, visible: false });
  const dialTimer = useRef<ReturnType<typeof setTimeout>>();
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const un = listen<OverlayEvent>('overlay', ({ payload: e }) => {
      if (e.kind === 'laser') {
        if (e.active) {
          clearTimeout(fadeTimer.current);
          setFading(false);
          setLaser({ x: e.x, y: e.y, style: e.style });
        } else {
          setFading(true);
          fadeTimer.current = setTimeout(() => setLaser(null), 600);
        }
      } else if (e.kind === 'dial' && e.detents !== 0) {
        setDial((d) => ({ total: d.total + e.detents, visible: true }));
        clearTimeout(dialTimer.current);
        dialTimer.current = setTimeout(() => setDial((d) => ({ ...d, visible: false })), 1200);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return (
    <>
      {laser?.style === 'spotlight' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: `radial-gradient(circle 110px at ${laser.x}px ${laser.y}px, transparent 0, transparent 85%, rgba(0,0,0,0.65) 100%)`,
            opacity: fading ? 0 : 1,
            transition: 'opacity 600ms ease-out',
          }}
        />
      )}
      {laser && laser.style !== 'spotlight' && (
        <div
          style={{
            position: 'fixed',
            left: laser.x - 14,
            top: laser.y - 14,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #ff3b30 0 32%, rgba(255,59,48,0.45) 45%, rgba(255,59,48,0) 70%)',
            opacity: fading ? 0 : 1,
            transition: 'opacity 600ms ease-out',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 48,
          transform: `translateX(-50%) translateY(${dial.visible ? 0 : 12}px)`,
          opacity: dial.visible ? 1 : 0,
          transition: 'opacity 220ms ease-out, transform 220ms ease-out',
          background: 'rgba(18,18,28,0.88)',
          color: '#ececf4',
          border: '1px solid #2a2a3a',
          borderRadius: 999,
          padding: '10px 18px',
          font: '600 15px -apple-system, "Segoe UI", system-ui, sans-serif',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        Dial {dial.total > 0 ? '+' : ''}
        {dial.total}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Overlay />);
