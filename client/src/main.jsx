import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import App from './App.jsx';
import { AppProvider } from './contexts/AppContext.jsx';
import theme from './theme.js';

const root = createRoot(document.getElementById('root'));
root.render(
  <ChakraProvider theme={theme}>
    <ColorModeScript initialColorMode={theme.config.initialColorMode} />
    <AppProvider>
      <App />
    </AppProvider>
  </ChakraProvider>
);
