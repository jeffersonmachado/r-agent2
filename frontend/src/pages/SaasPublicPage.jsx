import React, { useMemo, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import { signupSaas } from '../api/auth';
import './saasPublic.css';

const productItems = [
  {
    title: 'Atendimento Omnichannel',
    desc: 'WhatsApp, webchat, e-mail e voz com fila unificada e histórico completo.',
  },
  {
    title: 'Automação com IA',
    desc: 'Bots, triagem inteligente e sugestões assistidas para acelerar resolução.',
  },
  {
    title: 'Operação e Qualidade',
    desc: 'Métricas em tempo real, monitoramento de SLA e replay de atendimentos.',
  },
];

const solutionItems = [
  {
    title: 'SaaS para Suporte',
    desc: 'Estrutura completa para times de atendimento B2B e B2C com onboarding guiado.',
  },
  {
    title: 'SaaS para Vendas',
    desc: 'Conversão com campanhas, segmentação e acompanhamento do ciclo do lead.',
  },
  {
    title: 'SaaS para Operações',
    desc: 'Governança, auditoria e automações para reduzir custo operacional.',
  },
];

const planItems = [
  {
    name: 'Start',
    price: 'R$ 149',
    subtitle: '/usuário/mês',
    highlights: ['Webchat e WhatsApp', 'Métricas essenciais', 'Base de conhecimento'],
  },
  {
    name: 'Growth',
    price: 'R$ 289',
    subtitle: '/usuário/mês',
    highlights: ['Tudo do Start', 'Automação avançada', 'Relatórios gerenciais'],
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Sob consulta',
    subtitle: 'projeto customizado',
    highlights: ['Tudo do Growth', 'SSO/SCIM', 'Compliance e governança'],
  },
];

function SaasHeader({ onNavigate }) {
  return (
    <header className="saas-header">
      <button className="saas-brand" type="button" onClick={() => onNavigate('/')}>
        Results SaaS
      </button>
      <nav className="saas-nav">
        <button type="button" onClick={() => onNavigate('/saas/products')}>Produtos</button>
        <button type="button" onClick={() => onNavigate('/saas/solutions')}>Solucoes</button>
        <button type="button" onClick={() => onNavigate('/saas/pricing')}>Precos</button>
      </nav>
      <div className="saas-header-actions">
        <button type="button" className="saas-btn saas-btn-ghost" onClick={() => onNavigate('/login')}>
          Entrar
        </button>
        <button type="button" className="saas-btn saas-btn-solid" onClick={() => onNavigate('/saas/signup')}>
          Criar conta
        </button>
      </div>
    </header>
  );
}

function SaasHero({ onNavigate }) {
  return (
    <section className="saas-hero">
      <div>
        <p className="saas-kicker">Plataforma SaaS para atendimento e operacao</p>
        <h1>Centralize suporte, automacoes e inteligencia em um unico produto.</h1>
        <p className="saas-muted">
          Landing publica separada dos modulos internos da plataforma, com jornada de cadastro, precos,
          produtos e solucoes para prospects.
        </p>
        <div className="saas-hero-actions">
          <button type="button" className="saas-btn saas-btn-solid" onClick={() => onNavigate('/saas/signup')}>
            Comecar agora
          </button>
          <button type="button" className="saas-btn saas-btn-ghost" onClick={() => onNavigate('/saas/pricing')}>
            Ver planos
          </button>
        </div>
      </div>
      <div className="saas-hero-panel">
        <div className="saas-panel-head">Painel SaaS</div>
        <div className="saas-panel-body">
          <div>
            <strong>16m</strong>
            <span>tempo medio de resposta</span>
          </div>
          <div>
            <strong>94%</strong>
            <span>SLA cumprido</span>
          </div>
          <div>
            <strong>+22%</strong>
            <span>eficiencia operacional</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SaasCards({ title, items }) {
  return (
    <section className="saas-section">
      <h2>{title}</h2>
      <div className="saas-card-grid">
        {items.map((item) => (
          <article key={item.title} className="saas-card">
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SaasPricing({ onNavigate }) {
  return (
    <section className="saas-section">
      <h2>Precos transparentes para escalar com seguranca</h2>
      <div className="saas-plan-grid">
        {planItems.map((plan) => (
          <article key={plan.name} className={`saas-plan ${plan.featured ? 'featured' : ''}`}>
            <h3>{plan.name}</h3>
            <p className="saas-plan-price">{plan.price}</p>
            <p className="saas-plan-subtitle">{plan.subtitle}</p>
            <ul>
              {plan.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" className="saas-btn saas-btn-solid" onClick={() => onNavigate('/saas/signup')}>
              Escolher plano
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function SignupForm({ onNavigate }) {
  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    password: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => Object.values(form).every((value) => String(value).trim().length > 2), [form]);

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await signupSaas(form);
      setSubmitted(true);
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Não foi possível criar conta agora.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section className="saas-section saas-signup-wrap">
        <h2>Conta em preparacao</h2>
        <p className="saas-muted">Recebemos seus dados. Proximo passo: validar tenant e iniciar onboarding obrigatorio.</p>
        <button type="button" className="saas-btn saas-btn-solid" onClick={() => onNavigate('/login')}>
          Ir para login
        </button>
      </section>
    );
  }

  return (
    <section className="saas-section saas-signup-wrap">
      <h2>Criar conta</h2>
      <p className="saas-muted">Preencha para iniciar seu trial e seguir para o onboarding.</p>
      <form className="saas-signup-form" onSubmit={onSubmit}>
        <label>
          Nome
          <input value={form.name} onChange={(e) => onChange('name', e.target.value)} placeholder="Seu nome" />
        </label>
        <label>
          Empresa
          <input value={form.company} onChange={(e) => onChange('company', e.target.value)} placeholder="Nome da empresa" />
        </label>
        <label>
          E-mail corporativo
          <input value={form.email} onChange={(e) => onChange('email', e.target.value)} placeholder="voce@empresa.com" type="email" />
        </label>
        <label>
          Senha
          <input value={form.password} onChange={(e) => onChange('password', e.target.value)} placeholder="Crie uma senha" type="password" />
        </label>
        {error ? <p className="saas-signup-error">{error}</p> : null}
        <button type="submit" className="saas-btn saas-btn-solid" disabled={!canSubmit || submitting}>
          {submitting ? 'Criando conta...' : 'Criar conta e iniciar onboarding'}
        </button>
      </form>
    </section>
  );
}

function PublicWebchat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { from: 'bot', text: 'Oi. Sou o Webchat de demonstracao do SaaS. Como posso ajudar?' },
  ]);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = String(draft || '').trim();
    if (!text) return;
    setMessages((prev) => [...prev, { from: 'user', text }, { from: 'bot', text: 'Obrigado. Um especialista vai falar com voce em instantes.' }]);
    setDraft('');
  };

  return (
    <div className="saas-webchat">
      {open ? (
        <div className="saas-webchat-panel">
          <div className="saas-webchat-head">
            <strong>Webchat SaaS</strong>
            <button type="button" onClick={() => setOpen(false)}>Fechar</button>
          </div>
          <div className="saas-webchat-body">
            {messages.map((message, index) => (
              <div key={`${message.from}-${index}`} className={`saas-msg ${message.from}`}>
                {message.text}
              </div>
            ))}
          </div>
          <div className="saas-webchat-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Digite uma mensagem"
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
            />
            <button type="button" onClick={send}>Enviar</button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="saas-webchat-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Abrir webchat"
        title="Webchat"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7A2.5 2.5 0 0117.5 16H10l-4.2 3V16H6.5A2.5 2.5 0 014 13.5v-7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 9.5h8M8 12.5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function SaasPublicPage({ mode = 'landing' }) {
  const { navigate } = useRouter();

  return (
    <div className="saas-root">
      <SaasHeader onNavigate={navigate} />

      {mode === 'landing' ? (
        <>
          <SaasHero onNavigate={navigate} />
          <SaasCards title="Produtos" items={productItems} />
          <SaasCards title="Solucoes" items={solutionItems} />
          <SaasPricing onNavigate={navigate} />
        </>
      ) : null}

      {mode === 'products' ? <SaasCards title="Produtos" items={productItems} /> : null}
      {mode === 'solutions' ? <SaasCards title="Solucoes" items={solutionItems} /> : null}
      {mode === 'pricing' ? <SaasPricing onNavigate={navigate} /> : null}
      {mode === 'signup' ? <SignupForm onNavigate={navigate} /> : null}

      <footer className="saas-footer">
        <p>Results SaaS - Site publico</p>
        <div>
          <button type="button" onClick={() => navigate('/saas/products')}>Produtos</button>
          <button type="button" onClick={() => navigate('/saas/solutions')}>Solucoes</button>
          <button type="button" onClick={() => navigate('/saas/pricing')}>Precos</button>
          <button type="button" onClick={() => navigate('/login')}>Entrar</button>
        </div>
      </footer>

      <PublicWebchat />
    </div>
  );
}
