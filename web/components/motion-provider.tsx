'use client';

import { MotionConfig } from 'motion/react';

/** Con «reducir movimiento» del sistema, las animaciones de motion pasan a cambios instantáneos. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
