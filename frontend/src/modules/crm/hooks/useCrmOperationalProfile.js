import { useCallback, useEffect, useState } from 'react';
import { getCrmContactOperationalProfile } from '../../../api/crm';
import logger from '../../../utils/logger';

export function useCrmOperationalProfile({
  contactId,
  enabled = true,
  timelineLimit = 20,
}) {
  const [profile, setProfile] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    const id = String(contactId || '').trim();
    if (!enabled || !id) {
      setProfile(null);
      setTimeline([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const out = await getCrmContactOperationalProfile(id, { timelineLimit });
      setProfile(out?.profile || null);
      setTimeline(Array.isArray(out?.timeline?.items) ? out.timeline.items : []);
    } catch (err) {
      logger.error('Erro ao carregar perfil operacional CRM do contato', err);
      setProfile(null);
      setTimeline([]);
    } finally {
      setLoading(false);
    }
  }, [contactId, enabled, timelineLimit]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadProfile();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  return {
    profile,
    timeline,
    loading,
    reload: loadProfile,
  };
}
