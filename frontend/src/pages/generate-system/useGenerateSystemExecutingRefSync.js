import { useEffect } from 'react';

export const useGenerateSystemExecutingRefSync = ({ executing, executingRef }) => {
  useEffect(() => {
    executingRef.current = executing;
  }, [executing, executingRef]);
};
