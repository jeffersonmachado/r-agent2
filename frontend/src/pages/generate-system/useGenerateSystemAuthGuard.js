import { useEffect } from 'react';

export const useGenerateSystemAuthGuard = ({ isAuthenticated, authLoading, navigate }) => {
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
};
