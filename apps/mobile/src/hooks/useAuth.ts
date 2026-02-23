import { useState } from 'react';
import type { RegisteredPush } from '../push';

export function useAuth() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [agentId, setAgentId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [sessionBootstrapping, setSessionBootstrapping] = useState(true);
  const [status, setStatus] = useState('Aguardando login');
  const [error, setError] = useState('');
  const [registeredPush, setRegisteredPush] = useState<RegisteredPush | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<'username' | 'password' | null>(null);
  const [startupBlockedReason, setStartupBlockedReason] = useState<string | null>(null);

  return {
    username,
    setUsername,
    password,
    setPassword,
    authToken,
    setAuthToken,
    agentId,
    setAgentId,
    tenantId,
    setTenantId,
    sessionBootstrapping,
    setSessionBootstrapping,
    status,
    setStatus,
    error,
    setError,
    registeredPush,
    setRegisteredPush,
    loading,
    setLoading,
    focusedField,
    setFocusedField,
    startupBlockedReason,
    setStartupBlockedReason,
  };
}
