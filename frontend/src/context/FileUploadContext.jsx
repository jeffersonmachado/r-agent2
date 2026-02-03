import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

/**
 * Sub-máquina de estados de upload/processamento de arquivos.
 *
 * Regras:
 * - status: pending → processing → success | error
 * - nunca permanecer em pending após processamento iniciar
 * - transições ilegais são ignoradas (mantém status anterior)
 */

const FileUploadContext = createContext(null);

const FileStatus = Object.freeze({
  pending: 'pending',
  processing: 'processing',
  success: 'success',
  error: 'error',
});

const allowedTransitions = Object.freeze({
  // Observação: em React, updates podem ser batched; em alguns fluxos o status pode “pular”
  // de pending → success no mesmo ciclo (ex.: dry-run muito rápido). Permitimos para evitar
  // ficar preso em pending por transição considerada “ilegal”.
  [FileStatus.pending]: new Set([FileStatus.processing, FileStatus.success, FileStatus.error]),
  [FileStatus.processing]: new Set([FileStatus.success, FileStatus.error]),
  [FileStatus.success]: new Set([]),
  [FileStatus.error]: new Set([]),
});

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = allowedTransitions[from];
  if (!allowed) return false;
  return allowed.has(to);
}

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `file-${crypto.randomUUID()}`;
    }
  } catch {
    // noop
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialState() {
  return {
    files: [],
  };
}

function reducer(state, action) {
  if (!action || typeof action !== 'object') return state;

  switch (action.type) {
    case 'FILES_ADD': {
      const incoming = Array.isArray(action.files) ? action.files : [];
      if (incoming.length === 0) return state;
      return {
        ...state,
        files: [...state.files, ...incoming],
      };
    }

    case 'FILE_UPDATE': {
      const { fileId, patch } = action;
      if (!fileId || !patch || typeof patch !== 'object') return state;

      return {
        ...state,
        files: state.files.map((f) => {
          if (f.id !== fileId) return f;

          // Enforce status machine
          if (patch.status && typeof patch.status === 'string') {
            const nextStatus = patch.status;
            const prevStatus = f.status || FileStatus.pending;
            if (!canTransition(prevStatus, nextStatus)) {
              // ignora transição ilegal
              const { status: _ignored, ...rest } = patch;
              return { ...f, ...rest };
            }
          }

          return { ...f, ...patch };
        }),
      };
    }

    case 'FILE_REMOVE': {
      const { fileId } = action;
      if (!fileId) return state;
      return {
        ...state,
        files: state.files.filter((f) => f.id !== fileId),
      };
    }

    case 'FILES_RESET': {
      return initialState();
    }

    default:
      return state;
  }
}

export function FileUploadProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  const addSelectedFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return [];

    const newFiles = files.map((file) => ({
      file,
      id: makeId(),
      name: file.name,
      size: file.size,
      category: 'outros',
      status: FileStatus.pending,
      progress: 0,
      error: null,
      preview: null,
      extractedContent: null,
      documentId: null,
      isDuplicate: false,
      dryRun: false,
    }));

    dispatch({ type: 'FILES_ADD', files: newFiles });
    return newFiles;
  }, []);

  const updateFile = useCallback((fileId, patch) => {
    dispatch({ type: 'FILE_UPDATE', fileId, patch });
  }, []);

  const removeFile = useCallback((fileId) => {
    dispatch({ type: 'FILE_REMOVE', fileId });
  }, []);

  const resetFiles = useCallback(() => {
    dispatch({ type: 'FILES_RESET' });
  }, []);

  const value = useMemo(() => {
    return {
      files: state.files,
      FileStatus,
      addSelectedFiles,
      updateFile,
      removeFile,
      resetFiles,
    };
  }, [state.files, addSelectedFiles, updateFile, removeFile, resetFiles]);

  return <FileUploadContext.Provider value={value}>{children}</FileUploadContext.Provider>;
}

export function useFileUpload() {
  const ctx = useContext(FileUploadContext);
  if (!ctx) {
    throw new Error('useFileUpload deve ser usado dentro de FileUploadProvider');
  }
  return ctx;
}

