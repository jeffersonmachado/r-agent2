import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const CrmContext = createContext();

export function CrmProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [leads, setLeads] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedPipeline, setSelectedPipeline] = useState(null);

  const clearError = useCallback(() => setError(null), []);

  const setErrorMsg = useCallback((msg) => {
    setError(msg);
    setTimeout(clearError, 5000);
  }, [clearError]);

  return (
    <CrmContext.Provider
      value={{
        accounts,
        setAccounts,
        contacts,
        setContacts,
        leads,
        setLeads,
        pipelines,
        setPipelines,
        opportunities,
        setOpportunities,
        activities,
        setActivities,
        loading,
        setLoading,
        error,
        setErrorMsg,
        clearError,
        selectedAccount,
        setSelectedAccount,
        selectedPipeline,
        setSelectedPipeline,
      }}
    >
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const context = useContext(CrmContext);
  if (!context) {
    throw new Error('useCrm must be used within CrmProvider');
  }
  return context;
}
