import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { listDocuments, createDocument, updateDocument, deleteDocument, reindexDocument } from '../api/ragDocuments';
import { generateFaqAnswers, generateFaqSuggestions } from '../api/faq';
import { CrudPageBase } from '../modules/crud-base';

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return safeString(iso);
  return date.toLocaleString('pt-BR');
}

function makeExecutionId() {
  const rand = Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/gi, '');
  return `exec-${Date.now()}-${rand}`.slice(0, 90);
}

function validateUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function FaqManagementPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <CrudPageBase title="❓ FAQ">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const [aiImportLoading, setAiImportLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [executionId] = useState(() => makeExecutionId());
  const [filters, setFilters] = useState({
    category: '',
    status: 'active',
    search: '',
  });

  const [aiForm, setAiForm] = useState({
    name: '',
    urlsText: '',
  });
  const [suggestedGroups, setSuggestedGroups] = useState(null); // [{category, questions}]
  const [suggestedCoverage, setSuggestedCoverage] = useState(null);
  const [suggestedExclusions, setSuggestedExclusions] = useState(null);
  const [suggestedMeta, setSuggestedMeta] = useState(null);
  const [selectedQuestions, setSelectedQuestions] = useState({}); // { [question]: true }
  const [generatedAnswers, setGeneratedAnswers] = useState({}); // { [question]: answer }

  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    category: '',
    tags: '',
    status: 'active',
    autoIndex: true,
  });

  const loadFaq = async () => {
    setLoading(true);
    try {
      const docs = await listDocuments({
        source: 'faq',
        category: filters.category || '',
        status: filters.status || '',
        search: filters.search || '',
      });
      setItems(Array.isArray(docs) ? docs : []);
    } catch (err) {
      logger.error('[FAQ] Erro ao carregar itens', err);
      showToast('Erro ao carregar FAQ', 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFaq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.status, filters.search]);

  const resetForm = () => {
    setFormData({
      question: '',
      answer: '',
      category: '',
      tags: '',
      status: 'active',
      autoIndex: true,
    });
    setEditingItem(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (doc) => {
    setEditingItem(doc);
    setFormData({
      question: safeString(doc?.title || ''),
      answer: safeString(doc?.content || ''),
      category: safeString(doc?.metadata?.category || ''),
      tags: Array.isArray(doc?.metadata?.tags) ? doc.metadata.tags.join(', ') : '',
      status: safeString(doc?.status || 'active') || 'active',
      autoIndex: false,
    });
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!formData.question.trim() || !formData.answer.trim()) {
      showToast('Pergunta e resposta são obrigatórias', 'error');
      return;
    }

    try {
      const tagsArray = String(formData.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 30);

      const res = await createDocument({
        title: formData.question.trim().slice(0, 220),
        content: formData.answer.trim(),
        status: formData.status || 'active',
        metadata: {
          source: 'faq',
          category: formData.category ? formData.category.trim().slice(0, 80) : null,
          tags: tagsArray,
        },
        autoIndex: formData.autoIndex !== false,
      });

      if (res?.success === false) {
        showToast(res?.error || 'Erro ao criar item de FAQ', 'error');
        return;
      }

      showToast('Item de FAQ criado com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      await loadFaq();
    } catch (err) {
      logger.error('[FAQ] Erro ao criar item', err);
      showToast('Erro ao criar item de FAQ', 'error');
    }
  };

  const handleUpdate = async () => {
    if (!editingItem?.id) return;
    if (!formData.question.trim() || !formData.answer.trim()) {
      showToast('Pergunta e resposta são obrigatórias', 'error');
      return;
    }

    try {
      const tagsArray = String(formData.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 30);

      const res = await updateDocument(editingItem.id, {
        title: formData.question.trim().slice(0, 220),
        content: formData.answer.trim(),
        status: formData.status || 'active',
        metadata: {
          source: 'faq',
          category: formData.category ? formData.category.trim().slice(0, 80) : null,
          tags: tagsArray,
        },
        reindex: formData.autoIndex === true,
      });

      if (res?.success === false) {
        showToast(res?.error || 'Erro ao atualizar item de FAQ', 'error');
        return;
      }

      showToast('Item de FAQ atualizado!', 'success');
      setShowModal(false);
      resetForm();
      await loadFaq();
    } catch (err) {
      logger.error('[FAQ] Erro ao atualizar item', err);
      showToast('Erro ao atualizar item de FAQ', 'error');
    }
  };

  const handleDelete = async (doc) => {
    const confirmed = await confirm(
      'Confirmar exclusão',
      `Tem certeza que deseja excluir a pergunta "${safeString(doc?.title).slice(0, 80)}"?`
    );
    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      showToast('Item removido', 'success');
      await loadFaq();
    } catch (err) {
      logger.error('[FAQ] Erro ao excluir item', err);
      showToast('Erro ao excluir item de FAQ', 'error');
    }
  };

  const handleReindex = async (doc) => {
    try {
      setLoading(true);
      const result = await reindexDocument(doc.id);
      showToast(`Reindexado! ${result?.chunksCreated || 0} chunks criados.`, 'success');
      await loadFaq();
    } catch (err) {
      logger.error('[FAQ] Erro ao reindexar', err);
      showToast('Erro ao reindexar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const categories = useMemo(() => {
    const docs = Array.isArray(items) ? items : [];
    return Array.from(new Set(docs.map((d) => d?.metadata?.category).filter(Boolean))).sort();
  }, [items]);

  const suggestedQuestionToCategory = useMemo(() => {
    const map = new Map();
    for (const g of Array.isArray(suggestedGroups) ? suggestedGroups : []) {
      const cat = safeString(g?.category || '').trim() || 'Outros';
      for (const q of Array.isArray(g?.questions) ? g.questions : []) {
        const s = safeString(q).trim();
        if (!s) continue;
        if (!map.has(s)) map.set(s, cat);
      }
    }
    return map;
  }, [suggestedGroups]);

  const suggestedFlatQuestions = useMemo(() => {
    const groups = Array.isArray(suggestedGroups) ? suggestedGroups : [];
    const out = [];
    const seen = new Set();
    for (const g of groups) {
      for (const q of Array.isArray(g?.questions) ? g.questions : []) {
        const s = safeString(q).replace(/\s+/g, ' ').trim();
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s.slice(0, 220));
        if (out.length >= 80) return out;
      }
    }
    return out;
  }, [suggestedGroups]);

  const selectedList = useMemo(() => {
    const out = [];
    for (const q of suggestedFlatQuestions) {
      if (selectedQuestions?.[q] === true) out.push(q);
    }
    return out;
  }, [selectedQuestions, suggestedFlatQuestions]);

  const visibleItems = Array.isArray(items) ? items : [];

  const handleSuggest = async () => {
    const validUrls = String(aiForm.urlsText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(validateUrl)
      .slice(0, 5);

    try {
      setAiLoading(true);
      const resp = await generateFaqSuggestions({
        executionId,
        pipelineStage: 'questionsGenerated',
        name: aiForm.name?.trim() || null,
        description: null,
        urls: validUrls,
        fileNames: [],
        contextMode: 'auto',
      });

      const data = (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object')
        ? resp.data
        : resp;

      const groups = Array.isArray(data?.faq) ? data.faq : null;
      const exclusions = Array.isArray(data?.exclusions) ? data.exclusions : null;
      const coverage = (typeof data?.coverage === 'number') ? data.coverage : null;
      const meta = (data?.meta && typeof data.meta === 'object') ? data.meta : null;

      setSuggestedGroups(groups && groups.length ? groups : null);
      setSuggestedExclusions(exclusions && exclusions.length ? exclusions : null);
      setSuggestedCoverage(coverage);
      setSuggestedMeta(meta);

      const flat = Array.isArray(data?.flatQuestions) && data.flatQuestions.length
        ? data.flatQuestions
        : (Array.isArray(groups) ? groups.flatMap((g) => (Array.isArray(g?.questions) ? g.questions : [])) : []);

      const initialSel = {};
      for (const q of Array.isArray(flat) ? flat : []) {
        const s = safeString(q).replace(/\s+/g, ' ').trim().slice(0, 220);
        if (!s) continue;
        initialSel[s] = true;
      }
      setSelectedQuestions(initialSel);
      setGeneratedAnswers({});

      showToast('Perguntas sugeridas com sucesso.', 'success');
    } catch (err) {
      logger.error('[FAQ] Falha ao sugerir perguntas', err);
      showToast(err?.message || 'Falha ao sugerir perguntas', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateAnswers = async () => {
    const qs = selectedList.slice(0, 50);
    if (qs.length === 0) {
      showToast('Selecione ao menos 1 pergunta.', 'warning');
      return;
    }

    const validUrls = String(aiForm.urlsText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(validateUrl)
      .slice(0, 5);

    try {
      setAiAnswerLoading(true);
      const resp = await generateFaqAnswers({
        executionId,
        name: aiForm.name?.trim() || null,
        urls: validUrls,
        fileNames: [],
        questions: qs,
        contextMode: 'auto',
      });

      const data = (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object')
        ? resp.data
        : resp;

      const outQs = Array.isArray(data?.questions) ? data.questions : qs;
      const outAs = Array.isArray(data?.answers) ? data.answers : [];
      const map = {};
      for (let i = 0; i < outQs.length; i++) {
        const q = safeString(outQs[i]).replace(/\s+/g, ' ').trim().slice(0, 220);
        const a = safeString(outAs[i]).trim();
        if (!q) continue;
        if (!a) continue;
        map[q] = a;
      }
      setGeneratedAnswers((prev) => ({ ...(prev || {}), ...map }));

      showToast('Respostas geradas.', 'success');
    } catch (err) {
      logger.error('[FAQ] Falha ao gerar respostas', err);
      showToast(err?.message || 'Falha ao gerar respostas', 'error');
    } finally {
      setAiAnswerLoading(false);
    }
  };

  const handleImportGenerated = async () => {
    const qs = selectedList.slice(0, 50);
    if (qs.length === 0) {
      showToast('Selecione ao menos 1 pergunta.', 'warning');
      return;
    }

    const confirmed = await confirm(
      'Importar para o FAQ',
      `Importar ${qs.length} item(ns) selecionado(s) para o FAQ?`
    );
    if (!confirmed) return;

    const existing = new Set(
      (Array.isArray(items) ? items : [])
        .map((d) => safeString(d?.title).trim().toLowerCase())
        .filter(Boolean)
    );

    let created = 0;
    let skipped = 0;
    let missing = 0;
    try {
      setAiImportLoading(true);
      for (const q of qs) {
        const key = safeString(q).trim().toLowerCase();
        if (!key) continue;
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        const answer = safeString(generatedAnswers?.[q]).trim();
        if (!answer) {
          missing += 1;
          continue;
        }

        const category = suggestedQuestionToCategory.get(q) || '';
        // eslint-disable-next-line no-await-in-loop
        const res = await createDocument({
          title: safeString(q).trim().slice(0, 220),
          content: answer,
          status: 'active',
          metadata: {
            source: 'faq',
            category: category ? String(category).slice(0, 80) : null,
            tags: ['ai'],
          },
          autoIndex: true,
        });

        if (res?.success === false) {
          // best-effort: não interrompe o batch
          logger.warn('[FAQ] Falha ao importar item (best-effort)', { error: res?.error || 'unknown' });
          continue;
        }

        created += 1;
        existing.add(key);
      }

      await loadFaq();
      showToast(`Importação concluída: ${created} criado(s), ${skipped} ignorado(s), ${missing} sem resposta.`, 'success', 9000);
    } catch (err) {
      logger.error('[FAQ] Falha ao importar', err);
      showToast(err?.message || 'Falha ao importar', 'error');
    } finally {
      setAiImportLoading(false);
    }
  };

  return (
    <CrudPageBase
      title="❓ FAQ"
      actions={(
        <Button
          onClick={openCreateModal}
          style={{ backgroundColor: '#25D366', color: 'white' }}
        >
          ➕ Novo item
        </Button>
      )}
    >

      {/* IA: sugerir perguntas + gerar respostas + importar */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-2xl font-bold text-text-primary">✨ FAQ com IA</h2>
          <div className="text-xs text-text-tertiary">
            executionId: <span className="font-mono">{executionId}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Nome/Contexto (opcional)
            </label>
            <input
              type="text"
              value={aiForm.name}
              onChange={(e) => setAiForm({ ...aiForm, name: e.target.value })}
              placeholder="Ex: Clínica XYZ / Loja ABC"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              URLs para contexto (1 por linha, opcional)
            </label>
            <textarea
              value={aiForm.urlsText}
              onChange={(e) => setAiForm({ ...aiForm, urlsText: e.target.value })}
              placeholder="https://meusite.com.br\nhttps://meusite.com.br/faq"
              rows={3}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button onClick={handleSuggest} disabled={aiLoading || aiAnswerLoading || aiImportLoading}>
            {aiLoading ? 'Sugerindo...' : 'Sugerir perguntas'}
          </Button>
          <Button onClick={handleGenerateAnswers} disabled={aiAnswerLoading || aiLoading || aiImportLoading || selectedList.length === 0}>
            {aiAnswerLoading ? 'Gerando...' : 'Gerar respostas'}
          </Button>
          <Button onClick={handleImportGenerated} disabled={aiImportLoading || aiLoading || aiAnswerLoading || selectedList.length === 0}>
            {aiImportLoading ? 'Importando...' : 'Importar selecionadas'}
          </Button>
          <span className="text-xs text-text-tertiary">
            {selectedList.length} selecionada(s) · {Object.keys(generatedAnswers || {}).length} resposta(s) pronta(s)
            {typeof suggestedCoverage === 'number' ? ` · Cobertura: ${Math.round(Math.max(0, Math.min(1, suggestedCoverage)) * 100)}%` : ''}
            {Number.isFinite(Number(suggestedMeta?.chunkTextsEffective)) ? ` (${Number(suggestedMeta.chunkTextsEffective)} chunks)` : ''}
          </span>
        </div>

        {Array.isArray(suggestedExclusions) && suggestedExclusions.length > 0 && (
          <div className="mt-4 text-xs text-text-tertiary">
            Exclusões inferidas: {suggestedExclusions.slice(0, 12).join(', ')}
            {suggestedExclusions.length > 12 ? ` (+${suggestedExclusions.length - 12})` : ''}
          </div>
        )}

        {Array.isArray(suggestedFlatQuestions) && suggestedFlatQuestions.length > 0 && (
          <div className="mt-6 border border-border-default rounded-lg bg-bg-secondary p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-sm font-semibold text-text-primary">Perguntas sugeridas</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-accent-primary hover:text-accent-hover"
                  onClick={() => {
                    const next = {};
                    for (const q of suggestedFlatQuestions) next[q] = true;
                    setSelectedQuestions(next);
                  }}
                >
                  Selecionar todas
                </button>
                <button
                  type="button"
                  className="text-xs text-accent-primary hover:text-accent-hover"
                  onClick={() => setSelectedQuestions({})}
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {suggestedFlatQuestions.map((q) => {
                const checked = selectedQuestions?.[q] === true;
                const cat = suggestedQuestionToCategory.get(q) || null;
                const hasAnswer = !!safeString(generatedAnswers?.[q]).trim();
                return (
                  <label key={q} className="flex items-start gap-3 p-2 rounded hover:bg-bg-elevated/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelectedQuestions((prev) => ({ ...(prev || {}), [q]: e.target.checked }))}
                      className="mt-1 w-4 h-4"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {cat && (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-border-default text-text-tertiary">
                            {cat}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          hasAnswer ? 'border-green-500/40 text-green-500' : 'border-border-default text-text-tertiary'
                        }`}>
                          {hasAnswer ? 'Resposta pronta' : 'Sem resposta'}
                        </span>
                      </div>
                      {hasAnswer && (
                        <div className="mt-2 text-xs text-text-secondary whitespace-pre-wrap">
                          {safeString(generatedAnswers?.[q]).trim().slice(0, 260)}
                          {safeString(generatedAnswers?.[q]).trim().length > 260 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              placeholder="Buscar por pergunta ou resposta..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Categoria
            </label>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            >
              <option value="">Todas</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            >
              <option value="">Todos</option>
              <option value="active">Ativos</option>
              <option value="archived">Arquivados</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-text-primary">
            Itens ({visibleItems.length})
          </h2>
          {loading && (
            <span className="text-text-secondary">Carregando...</span>
          )}
        </div>

        {visibleItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">❓</div>
            <p className="text-text-secondary">
              Nenhum item encontrado. Crie seu primeiro FAQ.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleItems.map((doc) => {
              const status = safeString(doc?.status || 'active') || 'active';
              const updatedAt = doc?.metadata?.updatedAt || doc?.metadata?.createdAt || null;
              const tags = Array.isArray(doc?.metadata?.tags) ? doc.metadata.tags : [];
              return (
                <div
                  key={doc.id}
                  className="border border-border-default rounded-lg p-4 hover:border-accent-primary transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-text-primary">
                          {safeString(doc.title) || '(sem pergunta)'}
                        </h3>
                        <span className={`text-xs px-2 py-1 rounded-full border ${
                          status === 'active'
                            ? 'border-green-500/40 text-green-500'
                            : 'border-yellow-500/40 text-yellow-500'
                        }`}>
                          {status === 'active' ? 'Ativo' : 'Arquivado'}
                        </span>
                        {doc?.indexStatus && (
                          <span className="text-xs px-2 py-1 rounded-full border border-border-default text-text-tertiary">
                            Index: {safeString(doc.indexStatus)}
                          </span>
                        )}
                      </div>

                      {doc?.metadata?.category && (
                        <p className="text-sm text-text-secondary mt-1">
                          Categoria: {doc.metadata.category}
                        </p>
                      )}

                      {safeString(doc?.content).trim() && (
                        <p className="text-sm text-text-secondary mt-2 whitespace-pre-wrap">
                          {safeString(doc.content).trim().slice(0, 240)}
                          {safeString(doc.content).trim().length > 240 ? '...' : ''}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 mt-3">
                        {tags.slice(0, 8).map((t) => (
                          <span
                            key={t}
                            className="text-xs px-2 py-1 bg-bg-secondary text-text-secondary rounded-full border border-border-default"
                          >
                            {t}
                          </span>
                        ))}
                        {tags.length > 8 && (
                          <span className="text-xs text-text-tertiary">
                            +{tags.length - 8} tag(s)
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-text-tertiary mt-2">
                        Atualizado: {formatDateTime(updatedAt)}
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openEditModal(doc)}
                        className="text-accent-primary hover:text-accent-hover"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      {status === 'active' && !doc?.indexed && (
                        <button
                          onClick={() => handleReindex(doc)}
                          className="text-accent-primary hover:text-accent-hover"
                          title="Indexar"
                        >
                          🔍
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(doc)}
                        className="text-status-error hover:opacity-80"
                        title="Excluir"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
            }
          }}
        >
          <div
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingItem ? 'Editar' : 'Novo'} item de FAQ
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Pergunta *
                </label>
                <input
                  type="text"
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  placeholder="Ex: Quais são as formas de pagamento?"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Resposta *
                </label>
                <textarea
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  placeholder="Digite a resposta..."
                  rows={8}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Categoria
                  </label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="Ex: Pagamentos"
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  >
                    <option value="active">Ativo</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Tags (separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="Ex: pagamento, cartão, pix"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.autoIndex}
                    onChange={(e) => setFormData({ ...formData, autoIndex: e.target.checked })}
                    className="w-4 h-4"
                  />
                  {editingItem ? 'Reindexar após atualizar' : 'Indexar automaticamente após criar'}
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={editingItem ? handleUpdate : handleCreate}>
                {editingItem ? 'Atualizar' : 'Criar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}

