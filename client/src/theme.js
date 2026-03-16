import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  fonts: {
    heading: '"Space Grotesk", system-ui, -apple-system, Segoe UI, sans-serif',
    body: '"Space Grotesk", system-ui, -apple-system, Segoe UI, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  colors: {
    brand: {
      50: '#e6efff',
      100: '#c7d9ff',
      200: '#a6c1ff',
      300: '#86a9ff',
      400: '#6a94ff',
      500: '#4f7fff',
      600: '#3d66cc',
      700: '#2b4d99',
      800: '#1a3466',
      900: '#0b1d33',
    },
  },
  styles: {
    global: {
      body: {
        bg: 'linear-gradient(180deg, #0b0f1a 0%, #0b0d12 40%, #0a0c10 100%)',
        color: '#e6e9ef',
      },
      '#root': {
        minHeight: '100vh',
      },
    },
  },
  components: {
    Button: {
      defaultProps: {
        colorScheme: 'brand',
      },
    },
    Input: {
      variants: {
        outline: {
          field: {
            borderColor: '#2a3347',
            bg: '#0f131d',
            _focus: { borderColor: 'brand.400', boxShadow: '0 0 0 1px #6a94ff' },
          },
        },
      },
    },
    Select: {
      variants: {
        outline: {
          field: {
            borderColor: '#2a3347',
            bg: '#0f131d',
            _focus: { borderColor: 'brand.400', boxShadow: '0 0 0 1px #6a94ff' },
          },
        },
      },
    },
    Tabs: {
      variants: {
        enclosed: {
          tab: {
            _selected: {
              bg: '#141b2a',
              borderColor: '#2a3347',
            },
          },
        },
      },
    },
  },
});

export default theme;
