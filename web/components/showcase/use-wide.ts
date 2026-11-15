import { useSyncExternalStore } from 'react';

const WIDE = '(min-width: 860px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
  };
};

/** true desde 860 px: las secciones pegadas al scroll se despliegan; abajo de eso, se apilan. */
export const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

const FINE = '(pointer: fine)';
const subscribeFine = (cb: () => void) => {
  const mq = window.matchMedia(FINE);
  mq.addEventListener('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
  };
};

/** true con mouse o trackpad: el cursor propio solo tiene sentido ahí. */
export const useFinePointer = () =>
  useSyncExternalStore(
    subscribeFine,
    () => window.matchMedia(FINE).matches,
    () => false,
  );
