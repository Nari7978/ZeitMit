// The app is designed for phones. On tablets and other wide windows it shows the same layout in a framed column
// in the middle of the screen instead of stretching it across.
import { useWindowDimensions } from 'react-native';

export const APP_MAX_WIDTH = 560;
/** Side room a window needs before the column gets its frame (narrower windows just use their full width). */
const FRAME_ROOM = 48;

export function useAppFrame() {
  const { width } = useWindowDimensions();
  const framed = width > APP_MAX_WIDTH + FRAME_ROOM;
  return { framed, width: framed ? APP_MAX_WIDTH : width };
}

/** The width screens actually get: use it instead of the window width for anything sized to the screen. */
export const useAppWidth = () => useAppFrame().width;
