import React, { useState } from 'react';
import { Alert, AlertIcon, Box, Button, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { apiBaseUrl } from './utils';
import { useApp } from './contexts/AppContext.jsx';

export default function Login() {
  const { setToken } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: email,
          password: password,
        }),
      });
      if (!response.ok) {
        throw new Error('Login failed');
      }
      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        throw new Error('Registration failed');
      }
      // Automatically log in after successful registration
      await handleLogin(e);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box maxW="420px" mx="auto" mt={12}>
      <Box p={6}>
        <Stack spacing={4}>
          <Heading size="md" textAlign="center">
            {isRegistering ? 'Register' : 'Login'}
          </Heading>
          <Box as="form" onSubmit={isRegistering ? handleRegister : handleLogin}>
            <Stack spacing={3}>
              <Input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <Input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
              />
              <Button type="submit">
                {isRegistering ? 'Register' : 'Login'}
              </Button>
              {error && (
                <Alert status="error" borderRadius="8px">
                  <AlertIcon />
                  {error}
                </Alert>
              )}
            </Stack>
          </Box>
          <Button variant="ghost" onClick={() => setIsRegistering(!isRegistering)}>
            {isRegistering ? 'Already have an account? Login' : "Don't have an account? Register"}
          </Button>
          <Text fontSize="sm" color="gray.500" textAlign="center">
            Secure access to your workspace.
          </Text>
        </Stack>
      </Box>
    </Box>
  );
}
