import type { Config } from 'tailwindcss';
import {
  TAILWIND_FONT_SIZE,
  TAILWIND_FONT_WEIGHT,
  TAILWIND_RADIUS,
  TAILWIND_SPACING,
} from './design/tokens/tailwind.generated';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize: TAILWIND_FONT_SIZE,
      fontWeight: TAILWIND_FONT_WEIGHT,
      borderRadius: TAILWIND_RADIUS,
      spacing: TAILWIND_SPACING,
    },
  },
};

export default config;
