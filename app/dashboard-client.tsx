'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  CircleCheck,
  Clock3,
  Droplets,
  History,
  LoaderCircle,
  PackageCheck,
  Plus,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Member = {
  id: string;
  name: string;
  phone: string | null;
  queuePosition: number;
  creditCents: number;
  active: number;
  paymentStatus: 'pending' | 'paid' | null;
};
type Account = {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: 'admin' | 'client';
  active: number;
  createdAt: number;
};
type Data = {
  account: Account;
  accounts: Account[];
  settings: {
    totalBottles: number;
    fullBottles: number;
    bottlePriceCents: number;
    alertThreshold: number;
    nextQueuePosition: number;
  };
  members: Member[];
  payments: Array<{
    id: number;
    memberName: string;
    bottles: number;
    totalCents: number;
    creditUsedCents: number;
    paidCents: number;
    status: string;
    createdAt: number;
  }>;
  events: Array<{
    id: number;
    kind: string;
    quantity: number;
    note: string | null;
    createdAt: number;
    userName: string;
  }>;
  notifications: Array<{
    id: number;
    status: string;
    message: string;
    createdAt: number;
    memberName: string;
  }>;
};
type AlertItem = {
  id: string;
  title: string;
  detail: string;
  createdAt: number;
  tone: 'sky' | 'amber' | 'green';
};
type Modal =
  | 'member'
  | 'account'
  | 'empty'
  | 'stock'
  | 'credit'
  | 'edit_credit'
  | 'payment'
  | null;

export function Dashboard({
  identity,
}: {
  identity: { id: string; name: string };
}) {
  const [data, setData] = useState<Data | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Visão geral');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lastSeenNotification, setLastSeenNotification] = useState(() =>
    typeof window === 'undefined'
      ? 0
      : Number(
          window.localStorage.getItem(
            `cota-dagua-notifications-${identity.id}`,
          ) ?? 0,
        ),
  );
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window === 'undefined'
      ? 'default'
      : 'Notification' in window
        ? Notification.permission
        : 'unsupported',
  );
  const notifiedThrough = useRef(0);
  const load = useCallback(async () => {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error);
    setData(json);
  }, []);
  const logout = useCallback(async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    window.location.reload();
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setNotice(json.message);
        setModal(null);
        await load();
        if (json.whatsappUrl && !json.message.includes('enviada'))
          window.open(json.whatsappUrl, '_blank', 'noopener,noreferrer');
        return json;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'informar_garrafoes_vazios',
          title: 'Informar garrafões vazios',
          description:
            'Registra quantos garrafões acabaram e atualiza o painel do administrador.',
          inputSchema: {
            type: 'object',
            properties: {
              quantidade: { type: 'integer', minimum: 1, maximum: 100 },
              observacao: { type: 'string', maxLength: 180 },
            },
            required: ['quantidade'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const value = input as { quantidade: number; observacao?: string };
            return act({
              action: 'report_empty',
              quantity: value.quantidade,
              note: value.observacao ?? '',
            });
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [act]);

  const alertItems = useMemo<AlertItem[]>(() => {
    if (!data) return [];
    return [
      ...data.events.map((event) => ({
        id: `event-${event.id}`,
        title:
          event.kind === 'empty'
            ? 'Garrafões vazios informados'
            : 'Estoque atualizado',
        detail:
          event.kind === 'empty'
            ? `${event.userName} informou ${event.quantity} garrafão(ões) vazio(s).`
            : `${event.userName}: ${event.note || eventLabel(event.kind)}.`,
        createdAt: event.createdAt,
        tone: event.kind === 'empty' ? ('amber' as const) : ('sky' as const),
      })),
      ...data.notifications.map((notification) => ({
        id: `whatsapp-${notification.id}`,
        title:
          notification.status === 'sent'
            ? 'Mensagem enviada pelo WhatsApp'
            : notification.status === 'failed'
              ? 'Falha no envio pelo WhatsApp'
              : 'Mensagem aguardando envio',
        detail: `Destinatário: ${notification.memberName}.`,
        createdAt: notification.createdAt,
        tone:
          notification.status === 'sent'
            ? ('green' as const)
            : ('amber' as const),
      })),
    ].sort((a, b) => b.createdAt - a.createdAt);
  }, [data]);

  useEffect(() => {
    const latest = alertItems[0];
    if (!latest) return;
    if (notifiedThrough.current === 0) {
      notifiedThrough.current = latest.createdAt;
      return;
    }
    if (latest.createdAt <= notifiedThrough.current) return;
    notifiedThrough.current = latest.createdAt;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(latest.title, {
        body: latest.detail,
      });
    }
  }, [alertItems]);

  const admin = data?.account.role === 'admin';
  const clients = data?.members ?? [];
  const next = clients.find(
    (m) => m.queuePosition === data?.settings.nextQueuePosition,
  );
  const creditTotal = clients.reduce((sum, m) => sum + m.creditCents, 0);
  const empty =
    (data?.settings.totalBottles ?? 0) - (data?.settings.fullBottles ?? 0);
  const firstName = (data?.account.name || identity.name).split(' ')[0];
  const openForMember = (nextModal: Modal, memberId = '') => {
    setSelectedMemberId(memberId);
    setModal(nextModal);
  };
  const tabs = [
    'Visão geral',
    'Garrafões',
    'Pessoas da cota',
    'Pagamentos e créditos',
    'Histórico',
    ...(admin ? ['Usuários de acesso'] : []),
  ];
  const shownMembers = tab === 'Visão geral' ? clients.slice(0, 5) : clients;
  const unreadNotifications = alertItems.filter(
    (item) => item.createdAt > lastSeenNotification,
  ).length;
  const markNotificationsRead = () => {
    const newest = alertItems[0]?.createdAt ?? Date.now();
    setLastSeenNotification(newest);
    if (data?.account.id) {
      window.localStorage.setItem(
        `cota-dagua-notifications-${data.account.id}`,
        String(newest),
      );
    }
  };
  const toggleNotifications = () => {
    const willOpen = !notificationsOpen;
    setNotificationsOpen(willOpen);
    if (willOpen) markNotificationsRead();
  };
  const enableDesktopNotifications = async () => {
    if (!('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setDesktopPermission(permission);
      setNotice(
        permission === 'granted'
          ? 'Avisos do navegador ativados.'
          : 'O navegador não permitiu os avisos. O sininho continuará funcionando.',
      );
    } catch {
      setNotice(
        'O navegador não permite avisos neste endereço. O sininho continuará funcionando.',
      );
    }
  };

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-sky-100/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1480px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-sky-600 text-white shadow-[0_8px_24px_rgba(2,132,199,.24)]">
              <Droplets size={23} strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-[17px] font-extrabold tracking-tight">
                Cota D’Água
              </p>
              <p className="text-xs text-slate-500">
                Gestão simples, água em dia
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                aria-label="Abrir notificações"
                aria-expanded={notificationsOpen}
                onClick={toggleNotifications}
                className="relative grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
              >
                <BellRing size={18} />
                {unreadNotifications > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-white ring-2 ring-white">
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <section className="absolute right-0 top-12 z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-2xl">
                  <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                    <div>
                      <h2 className="font-extrabold text-slate-950">
                        Notificações
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Atualização automática a cada 15 segundos.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="rounded-lg px-2 py-1 text-lg text-slate-400 hover:bg-slate-100"
                      aria-label="Fechar notificações"
                    >
                      ×
                    </button>
                  </header>
                  <div className="max-h-[22rem] overflow-y-auto">
                    {alertItems.length === 0 ? (
                      <Empty text="Nenhuma notificação ainda." />
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {alertItems.slice(0, 10).map((item) => (
                          <article key={item.id} className="flex gap-3 p-4">
                            <span
                              className={`mt-1 size-2.5 shrink-0 rounded-full ${item.tone === 'amber' ? 'bg-amber-500' : item.tone === 'green' ? 'bg-emerald-500' : 'bg-sky-500'}`}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">
                                {item.title}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                {item.detail}
                              </p>
                              <time className="mt-1.5 block text-[11px] text-slate-400">
                                {date(item.createdAt)}
                              </time>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  <footer className="border-t border-slate-100 bg-slate-50 p-3">
                    {desktopPermission === 'granted' ? (
                      <p className="text-center text-xs font-bold text-emerald-700">
                        Avisos do navegador ativados
                      </p>
                    ) : desktopPermission === 'denied' ? (
                      <p className="text-center text-xs text-amber-700">
                        Avisos bloqueados no navegador. O sininho segue ativo.
                      </p>
                    ) : desktopPermission === 'unsupported' ? (
                      <p className="text-center text-xs text-slate-500">
                        O sininho está ativo neste dispositivo.
                      </p>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 w-full rounded-xl bg-white text-xs font-bold"
                        onClick={enableDesktopNotifications}
                      >
                        Ativar avisos do navegador
                      </Button>
                    )}
                  </footer>
                </section>
              )}
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold">
                {data?.account.name || identity.name}
              </p>
              <p className="text-xs text-slate-500">
                {admin ? 'Administrador' : 'Cliente'}
              </p>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">
              {initials(data?.account.name || identity.name)}
            </span>
            <button
              onClick={logout}
              className="rounded-lg px-2 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1480px] lg:grid-cols-[230px_1fr]">
        <aside className="hidden min-h-[calc(100vh-80px)] border-r border-sky-100 p-5 lg:block">
          <nav className="space-y-1.5" aria-label="Menu principal">
            {tabs.map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${tab === item ? 'bg-sky-50 text-sky-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <span
                  className={`size-2 rounded-full ${tab === item ? 'bg-sky-500' : 'bg-slate-300'}`}
                />
                {item}
              </button>
            ))}
          </nav>
          <div className="mt-10 rounded-2xl bg-slate-900 p-4 text-white">
            <Droplets className="mb-5 text-sky-300" />
            <p className="text-sm font-bold">Algum garrafão acabou?</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Informe agora para atualizar o estoque e avisar o administrador.
            </p>
            <button
              onClick={() => setModal('empty')}
              className="mt-4 w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-900"
            >
              Informar garrafões
            </button>
          </div>
        </aside>
        <section className="min-w-0 p-5 md:p-8 lg:p-10">
          <div className="mb-5 flex gap-2 overflow-auto lg:hidden">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${tab === t ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {(notice || error) && (
            <div
              role="status"
              className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
            >
              <span>{error || notice}</span>
              <button
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
          )}
          {!data ? (
            <div className="grid min-h-[55vh] place-items-center">
              <LoaderCircle className="animate-spin text-sky-600" />
            </div>
          ) : (
            <>
              <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-sm font-semibold text-sky-600">
                    {today()}
                  </p>
                  <h1 className="text-3xl font-black tracking-[-.04em] text-slate-950 md:text-4xl">
                    {tab === 'Visão geral' ? `Bom dia, ${firstName}.` : tab}
                  </h1>
                  <p className="mt-2 text-slate-500">
                    {admin
                      ? 'Acompanhe e administre a cota de água.'
                      : 'Acompanhe a cota e informe garrafões vazios.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {admin && (
                    <>
                      <Button
                        onClick={() => setModal('member')}
                        className="h-11 rounded-xl bg-sky-600 px-5 font-bold"
                      >
                        <Plus />
                        Pessoa na cota
                      </Button>
                      {tab === 'Usuários de acesso' && (
                        <Button
                          onClick={() => setModal('account')}
                          variant="outline"
                          className="h-11 rounded-xl px-5 font-bold"
                        >
                          <Plus />
                          Novo usuário
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    onClick={() => setModal('empty')}
                    variant="outline"
                    className="h-11 rounded-xl px-5 font-bold"
                  >
                    <Droplets />
                    Informar vazio
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  icon={<PackageCheck />}
                  label="Garrafões cheios"
                  value={String(data.settings.fullBottles)}
                  detail={`de ${data.settings.totalBottles} cadastrados`}
                  color="sky"
                />
                <Metric
                  icon={<Droplets />}
                  label="Garrafões vazios"
                  value={String(empty)}
                  detail="aguardando reposição"
                  color="amber"
                />
                <Metric
                  icon={<UsersRound />}
                  label="Pessoas na cota"
                  value={String(clients.length)}
                  detail={`${clients.filter((m) => m.active).length} ativas`}
                  color="violet"
                />
                {admin ? (
                  <Metric
                    icon={<WalletCards />}
                    label="Créditos disponíveis"
                    value={money(creditTotal)}
                    detail="saldo total da cota"
                    color="green"
                  />
                ) : (
                  <Metric
                    icon={<CircleCheck />}
                    label="Seu acesso"
                    value="Cliente"
                    detail="pode informar garrafões vazios"
                    color="green"
                  />
                )}
              </div>
              {tab === 'Garrafões' ? (
                <Garrafões
                  data={data}
                  admin={admin}
                  openStock={() => setModal('stock')}
                  openEmpty={() => setModal('empty')}
                />
              ) : tab === 'Pagamentos e créditos' ? (
                <Financeiro
                  data={data}
                  admin={admin}
                  openCredit={() => openForMember('credit')}
                  openPayment={() => openForMember('payment')}
                />
              ) : tab === 'Histórico' ? (
                <Historico data={data} />
              ) : tab === 'Usuários de acesso' && admin ? (
                <Accounts
                  accounts={data.accounts}
                  openAccount={() => setModal('account')}
                />
              ) : (
                <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.8fr]">
                  <Members
                    members={shownMembers}
                    next={next}
                    admin={admin}
                    openCredit={(id) => openForMember('credit', id)}
                    editCredit={(id) => openForMember('edit_credit', id)}
                    markPaid={(id) => openForMember('payment', id)}
                    charge={(id) =>
                      act({ action: 'charge_member', memberId: id, bottles: 1 })
                    }
                    busy={busy}
                    expanded={tab === 'Pessoas da cota'}
                  />
                  <div className="space-y-6">
                    <section className="overflow-hidden rounded-[22px] bg-gradient-to-br from-sky-600 to-cyan-500 p-6 text-white shadow-[0_16px_34px_rgba(2,132,199,.22)]">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[.12em] text-sky-100">
                            Próximo pagamento
                          </p>
                          <h2 className="mt-3 text-2xl font-black">
                            {next?.name || 'Fila ainda vazia'}
                          </h2>
                          <p className="mt-1 text-sm text-sky-100">
                            {next
                              ? `1 garrafão • ${money(data.settings.bottlePriceCents)}`
                              : 'Cadastre pessoas na cota'}
                          </p>
                        </div>
                        <span className="grid size-12 place-items-center rounded-2xl bg-white/18 text-sm font-black">
                          {initials(next?.name || '--')}
                        </span>
                      </div>
                      <div className="my-5 h-px bg-white/20" />
                      <div className="flex items-center gap-2 text-sm">
                        <Clock3 size={16} />
                        <span>
                          {next?.phone
                            ? 'WhatsApp pronto para notificar'
                            : 'Cadastre o telefone para notificar'}
                        </span>
                      </div>
                      {admin && next && (
                        <button
                          onClick={() =>
                            act({
                              action: 'send_notification',
                              bottles: 1,
                            }).catch(() => {})
                          }
                          disabled={busy}
                          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-extrabold text-sky-700"
                        >
                          Enviar agora <ArrowRight size={16} />
                        </button>
                      )}
                    </section>
                    <section className="rounded-[22px] border border-emerald-100 bg-emerald-50/60 p-5">
                      <div className="flex gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                          <CircleCheck size={20} />
                        </span>
                        <div>
                          <h3 className="text-sm font-extrabold text-emerald-950">
                            {data.settings.fullBottles >
                            data.settings.alertThreshold
                              ? 'Estoque sob controle'
                              : 'Atenção ao estoque'}
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                            Restam {data.settings.fullBottles} garrafões cheios.
                            O limite de alerta é {data.settings.alertThreshold}.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <Forms
        modal={modal}
        setModal={setModal}
        data={data}
        busy={busy}
        act={act}
        selectedMemberId={selectedMemberId}
      />
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <article className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_8px_25px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between">
        <span className={`metric-icon metric-${color}`}>{icon}</span>
        <span className="text-xs font-bold text-emerald-600">Atualizado</span>
      </div>
      <p className="mt-5 text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </article>
  );
}
function Accounts({
  accounts,
  openAccount,
}: {
  accounts: Account[];
  openAccount: () => void;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 md:px-6">
        <div>
          <h2 className="text-lg font-extrabold">Usuários de acesso</h2>
          <p className="mt-1 text-sm text-slate-500">
            Somente o administrador pode visualizar e cadastrar logins.
          </p>
        </div>
        <Button
          onClick={openAccount}
          className="rounded-xl bg-sky-600 font-bold"
        >
          <Plus /> Novo usuário
        </Button>
      </div>
      <div className="divide-y divide-slate-100">
        {accounts.map((account, index) => (
          <div
            key={account.id}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-4 md:px-6"
          >
            <span
              className={`avatar avatar-${['blue', 'green', 'violet', 'amber'][index % 4]}`}
            >
              {initials(account.name)}
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">{account.name}</p>
              <p className="text-xs text-slate-500">@{account.username}</p>
            </div>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
              {account.role === 'admin' ? 'Administrador' : 'Cliente'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
function Members({
  members,
  next,
  admin,
  openCredit,
  editCredit,
  markPaid,
  charge,
  busy,
  expanded,
}: {
  members: Member[];
  next?: Member;
  admin: boolean;
  openCredit: (memberId?: string) => void;
  editCredit: (memberId: string) => void;
  markPaid: (memberId: string) => void;
  charge: (memberId: string) => Promise<unknown>;
  busy: boolean;
  expanded: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.05)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 md:px-6">
        <div>
          <h2 className="text-lg font-extrabold">Ordem da cota</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pagamentos, créditos e próxima vez.
          </p>
        </div>
        {admin && expanded && (
          <button
            onClick={() => openCredit()}
            className="text-sm font-bold text-sky-700"
          >
            Lançar crédito
          </button>
        )}
      </div>
      {members.length === 0 ? (
        <Empty text="Nenhuma pessoa cadastrada na cota." />
      ) : (
        <div className="divide-y divide-slate-100">
          {members.map((m, i) => (
            <div
              key={m.id}
              className="grid grid-cols-[auto_1fr] items-center gap-3 px-5 py-4 md:grid-cols-[auto_1fr_150px_100px] md:px-6"
            >
              <span
                className={`avatar avatar-${['amber', 'green', 'blue', 'violet'][i % 4]}`}
              >
                {initials(m.name)}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">{m.name}</p>
                <p className="text-xs text-slate-500">
                  {m.phone || 'WhatsApp não informado'}
                </p>
              </div>
              <span
                className={`mt-1 w-fit rounded-full px-2.5 py-1 text-[11px] font-bold md:mt-0 ${m.id === next?.id ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}
              >
                {m.id === next?.id
                  ? 'Próximo da vez'
                  : `Posição ${m.queuePosition}`}
              </span>
              <p className="hidden text-right text-sm font-extrabold md:block">
                {money(m.creditCents)}
              </p>
              {admin && expanded && (
                <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <span
                    className={`mr-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${m.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-700' : m.paymentStatus === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {m.paymentStatus === 'paid'
                      ? 'Pagamento confirmado'
                      : m.paymentStatus === 'pending'
                        ? 'Aguardando pagamento'
                        : 'Sem pagamento registrado'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !m.phone}
                    onClick={() => charge(m.id).catch(() => {})}
                    title={m.phone ? 'Enviar cobrança' : 'Cadastre um WhatsApp'}
                  >
                    Cobrar no WhatsApp
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => editCredit(m.id)}
                  >
                    Editar crédito
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => markPaid(m.id)}
                    disabled={busy || m.paymentStatus === 'paid'}
                  >
                    {m.paymentStatus === 'paid'
                      ? 'Já está pago'
                      : 'Marcar como pago'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function Garrafões({
  data,
  admin,
  openStock,
  openEmpty,
}: {
  data: Data;
  admin: boolean;
  openStock: () => void;
  openEmpty: () => void;
}) {
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <section className="rounded-[22px] border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold">Controle do estoque</h2>
        <div className="mt-6 h-4 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-sky-500"
            style={{
              width: `${data.settings.totalBottles ? (data.settings.fullBottles / data.settings.totalBottles) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {data.settings.fullBottles} cheios de um total de{' '}
          {data.settings.totalBottles} garrafões.
        </p>
        <div className="mt-6 flex gap-2">
          <Button onClick={openEmpty} className="h-10 rounded-xl bg-sky-600">
            Informar vazio
          </Button>
          {admin && (
            <Button
              onClick={openStock}
              variant="outline"
              className="h-10 rounded-xl"
            >
              Configurar estoque
            </Button>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
        <div className="border-b p-5">
          <h2 className="font-extrabold">Últimas movimentações</h2>
        </div>
        {data.events.length ? (
          <div className="divide-y">
            {data.events.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between p-4 text-sm"
              >
                <div>
                  <b>{e.userName}</b>
                  <p className="text-xs text-slate-500">
                    {e.note || eventLabel(e.kind)}
                  </p>
                </div>
                <span className="font-bold">
                  {e.kind === 'empty' ? '-' : ''}
                  {e.quantity}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Nenhuma movimentação ainda." />
        )}
      </section>
    </div>
  );
}
function Financeiro({
  data,
  admin,
  openCredit,
  openPayment,
}: {
  data: Data;
  admin: boolean;
  openCredit: () => void;
  openPayment: () => void;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-[22px] border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="font-extrabold">Pagamentos registrados</h2>
          <p className="text-sm text-slate-500">
            Histórico com uso de crédito e valor pago.
          </p>
        </div>
        {admin && (
          <div className="flex gap-2">
            <Button onClick={openCredit} variant="outline">
              Adicionar crédito
            </Button>
            <Button onClick={openPayment} className="bg-sky-600">
              Registrar pagamento
            </Button>
          </div>
        )}
      </div>
      {data.payments.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-4">Pessoa</th>
                <th>Garrafões</th>
                <th>Total</th>
                <th>Crédito usado</th>
                <th>Pago</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="p-4 font-bold">{p.memberName}</td>
                  <td>{p.bottles}</td>
                  <td>{money(p.totalCents)}</td>
                  <td>{money(p.creditUsedCents)}</td>
                  <td>{money(p.paidCents)}</td>
                  <td>{date(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty text="Nenhum pagamento registrado." />
      )}
    </section>
  );
}
function Historico({ data }: { data: Data }) {
  const items = [
    ...data.events.map((e) => ({
      id: `e${e.id}`,
      title: `${e.userName}: ${eventLabel(e.kind)}`,
      detail: `${e.quantity} garrafão(ões)`,
      createdAt: e.createdAt,
    })),
    ...data.notifications.map((n) => ({
      id: `n${n.id}`,
      title: `WhatsApp para ${n.memberName}`,
      detail: n.status === 'sent' ? 'Enviado' : 'Status: ' + n.status,
      createdAt: n.createdAt,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="mt-6 rounded-[22px] border border-slate-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-extrabold">
        <History size={18} />
        Atividades recentes
      </h2>
      {items.length ? (
        <div className="mt-4 divide-y">
          {items.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-bold">{i.title}</p>
                <p className="text-xs text-slate-500">{i.detail}</p>
              </div>
              <time className="text-xs text-slate-400">
                {date(i.createdAt)}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="Nenhuma atividade registrada." />
      )}
    </section>
  );
}

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {children}
      <button
        onClick={() => onOpenChange(false)}
        aria-label="Fechar janela"
        className="fixed right-6 top-6 grid size-10 place-items-center rounded-full bg-white text-xl text-slate-600 shadow-lg"
      >
        ×
      </button>
    </div>
  );
}
function DialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      className={`w-full bg-white shadow-2xl ${className ?? ''}`}
    >
      {children}
    </section>
  );
}
function DialogHeader({ children }: { children: React.ReactNode }) {
  return <header className="mb-2 space-y-2">{children}</header>;
}
function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <h2 className={className}>{children}</h2>;
}
function DialogDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

function Forms({
  modal,
  setModal,
  data,
  busy,
  act,
  selectedMemberId,
}: {
  modal: Modal;
  setModal: (m: Modal) => void;
  data: Data | null;
  busy: boolean;
  act: (b: Record<string, unknown>) => Promise<unknown>;
  selectedMemberId: string;
}) {
  const submit = (action: string) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    act({ action, ...values }).catch(() => {});
  };
  const clients = data?.members ?? [];
  return (
    <Dialog
      open={modal !== null}
      onOpenChange={(open) => !open && setModal(null)}
    >
      <DialogContent className="max-w-md rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold">
            {modalTitle(modal)}
          </DialogTitle>
          <DialogDescription>{modalDescription(modal)}</DialogDescription>
        </DialogHeader>
        {modal === 'member' && (
          <form onSubmit={submit('add_member')} className="space-y-4">
            <Field name="name" label="Nome completo" />
            <Field
              name="phone"
              label="WhatsApp com DDD"
              placeholder="(85) 9 9999-9999"
            />
            <p className="rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
              Este cadastro participa da fila, dos pagamentos e dos créditos,
              mas não cria um login no sistema.
            </p>
            <Submit busy={busy}>Adicionar à cota</Submit>
          </form>
        )}
        {modal === 'account' && (
          <form onSubmit={submit('add_account')} className="space-y-4">
            <Field name="name" label="Nome do usuário" />
            <Field
              name="username"
              label="Login"
              placeholder="Ex.: joao.silva"
            />
            <Field
              name="password"
              label="Senha inicial"
              type="password"
              minLength={8}
            />
            <Field
              name="phone"
              label="WhatsApp (opcional)"
              placeholder="(85) 9 9999-9999"
              required={false}
            />
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              O usuário poderá entrar como cliente e informar garrafões vazios.
              Ele não será incluído automaticamente na cota.
            </p>
            <Submit busy={busy}>Criar acesso de cliente</Submit>
          </form>
        )}
        {modal === 'empty' && (
          <form onSubmit={submit('report_empty')} className="space-y-4">
            <Field
              name="quantity"
              label="Quantos garrafões acabaram?"
              type="number"
              min="1"
              defaultValue="1"
            />
            <Field name="note" label="Observação (opcional)" required={false} />
            <Submit busy={busy}>Avisar administrador</Submit>
          </form>
        )}
        {modal === 'stock' && (
          <form
            onSubmit={submit('set_stock')}
            className="grid grid-cols-2 gap-4"
          >
            <Field
              name="total"
              label="Total de garrafões"
              type="number"
              min="0"
              defaultValue={data?.settings.totalBottles}
            />
            <Field
              name="full"
              label="Quantos estão cheios"
              type="number"
              min="0"
              defaultValue={data?.settings.fullBottles}
            />
            <Field
              name="price"
              label="Preço por garrafão"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={(data?.settings.bottlePriceCents ?? 2000) / 100}
            />
            <Field
              name="threshold"
              label="Avisar quando restarem"
              type="number"
              min="0"
              defaultValue={data?.settings.alertThreshold}
            />
            <div className="col-span-2">
              <Submit busy={busy}>Salvar estoque</Submit>
            </div>
          </form>
        )}
        {modal === 'credit' && (
          <form onSubmit={submit('add_credit')} className="space-y-4">
            <MemberSelect
              clients={clients}
              selectedMemberId={selectedMemberId}
            />
            <Field
              name="amount"
              label="Valor do crédito"
              type="number"
              min="0.01"
              step="0.01"
            />
            <Field name="note" label="Motivo (opcional)" required={false} />
            <Submit busy={busy}>Adicionar crédito</Submit>
          </form>
        )}
        {modal === 'edit_credit' && (
          <form
            key={selectedMemberId}
            onSubmit={submit('edit_credit')}
            className="space-y-4"
          >
            <MemberSelect
              clients={clients}
              selectedMemberId={selectedMemberId}
            />
            <Field
              name="amount"
              label="Novo saldo de crédito"
              type="number"
              min="0"
              step="0.01"
              defaultValue={
                (clients.find((member) => member.id === selectedMemberId)
                  ?.creditCents ?? 0) / 100
              }
            />
            <Field
              name="note"
              label="Motivo da correção (opcional)"
              required={false}
            />
            <Submit busy={busy}>Salvar novo saldo</Submit>
          </form>
        )}
        {modal === 'payment' && (
          <form onSubmit={submit('record_payment')} className="space-y-4">
            <MemberSelect
              clients={clients}
              selectedMemberId={selectedMemberId}
            />
            <Field
              name="bottles"
              label="Quantidade de garrafões"
              type="number"
              min="1"
              defaultValue="1"
            />
            <p className="rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
              O crédito disponível será descontado automaticamente. Depois, a
              próxima pessoa receberá a mensagem da sua vez.
            </p>
            <Submit busy={busy}>Confirmar pagamento</Submit>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
function Field(props: React.ComponentProps<'input'> & { label: string }) {
  const { label, ...input } = props;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={String(input.name)}>{label}</Label>
      <Input
        id={String(input.name)}
        className="h-11 rounded-xl"
        required={input.required !== false}
        {...input}
      />
    </div>
  );
}
function MemberSelect({
  clients,
  selectedMemberId = '',
}: {
  clients: Member[];
  selectedMemberId?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="memberId">Pessoa</Label>
      <select
        id="memberId"
        name="memberId"
        defaultValue={selectedMemberId}
        required
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
      >
        <option value="">Selecione</option>
        {clients.map((m) => (
          <option value={m.id} key={m.id}>
            {m.name} — crédito {money(m.creditCents)}
          </option>
        ))}
      </select>
    </div>
  );
}
function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      disabled={busy}
      type="submit"
      className="h-11 w-full rounded-xl bg-sky-600 font-bold"
    >
      {busy ? <LoaderCircle className="animate-spin" /> : children}
    </Button>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="grid min-h-36 place-items-center p-6 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
function modalTitle(m: Modal) {
  return (
    (
      {
        member: 'Cadastrar pessoa',
        account: 'Cadastrar usuário de acesso',
        empty: 'Informar garrafões vazios',
        stock: 'Configurar estoque',
        credit: 'Adicionar crédito',
        edit_credit: 'Editar saldo de crédito',
        payment: 'Registrar pagamento',
      } as Record<string, string>
    )[m || ''] || ''
  );
}
function modalDescription(m: Modal) {
  return (
    (
      {
        member: 'A pessoa entra no final da ordem da cota.',
        account: 'Crie um login separado do cadastro de pessoas da cota.',
        empty: 'O estoque será atualizado e o administrador verá o registro.',
        stock: 'Defina quantidade, valor e limite de alerta.',
        credit: 'O lançamento ficará salvo no histórico financeiro.',
        edit_credit:
          'Defina o saldo correto. A diferença ficará registrada no histórico.',
        payment: 'O crédito será aplicado e a fila avançará automaticamente.',
      } as Record<string, string>
    )[m || ''] || ''
  );
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((v) => v[0])
      .join('')
      .toUpperCase() || '--'
  );
}
function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
function date(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
function today() {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date())
    .toUpperCase();
}
function eventLabel(kind: string) {
  return kind === 'empty'
    ? 'Garrafão vazio informado'
    : kind === 'restock'
      ? 'Reposição registrada'
      : 'Estoque ajustado';
}
