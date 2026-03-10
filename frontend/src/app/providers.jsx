import React from 'react';
import { ThemeProvider } from '../styles/themeContext';
import { AuthProvider } from '../context/authContext';
import { WebSocketProvider } from '../context/WebSocketContext';
import { FileUploadProvider } from '../context/FileUploadContext';
import { PwaUpdateManager } from '../components/PwaUpdateManager';

export function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <FileUploadProvider>
            <PwaUpdateManager />
            {children}
          </FileUploadProvider>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
