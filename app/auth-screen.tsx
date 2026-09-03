'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  Droplets,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from 'lucide-react';

export function AuthScreen({ firstAccess }: { firstAccess: boolean }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: firstAccess ? 'setup' : 'login',
          ...values,
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? 'Não foi possível entrar.');
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar.');
      setBusy(false);
    }
  }

  // Password managers can inject controls into login inputs before React hydrates
  // the server HTML. Rendering the form only after hydration avoids that race.
  if (!hydrated) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[var(--background)]"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-4 text-sky-600">
          <span className="grid size-14 place-items-center rounded-2xl bg-sky-600 text-white">
            <Droplets />
          </span>
          <LoaderCircle className="size-6 animate-spin" />
          <span className="text-sm font-bold text-slate-500">
            Carregando acesso...
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-sky-700 via-sky-600 to-cyan-400 p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 size-[420px] rounded-full border-[80px] border-white/5" />
        <div className="absolute -bottom-36 -left-24 size-[480px] rounded-full border-[90px] border-white/5" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/15">
            <Droplets />
          </span>
          <div>
            <p className="text-lg font-black">Cota D’Água</p>
            <p className="text-xs text-sky-100">Gestão simples, água em dia</p>
          </div>
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-bold uppercase tracking-[.18em] text-sky-100">
            Controle local e seguro
          </p>
          <h1 className="mt-5 text-5xl font-black leading-[1.02] tracking-[-.045em]">
            Toda a sua cota de água em um só lugar.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-sky-50">
            Estoque, fila, pagamentos e créditos acessíveis para as pessoas
            autorizadas na sua rede.
          </p>
        </div>
        <p className="relative text-xs text-sky-100">
          Os dados ficam no banco SQLite desta instalação.
        </p>
      </section>
      <section className="flex items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <span className="grid size-11 place-items-center rounded-2xl bg-sky-600 text-white">
              <Droplets />
            </span>
            <b>Cota D’Água</b>
          </div>
          <p className="text-sm font-bold uppercase tracking-[.14em] text-sky-600">
            {firstAccess ? 'Primeiro acesso' : 'Área restrita'}
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            {firstAccess ? 'Cadastre o administrador' : 'Entre na sua conta'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {firstAccess
              ? 'Este usuário terá permissão para cadastrar clientes e administrar toda a cota.'
              : 'Use o usuário e a senha cadastrados pelo administrador.'}
          </p>
          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
          <form onSubmit={submit} className="mt-7 space-y-4">
            {firstAccess && (
              <>
                <AuthField
                  icon={<UserRound />}
                  label="Seu nome"
                  name="name"
                  placeholder="Nome completo"
                />
                <AuthField
                  icon={<Droplets />}
                  label="WhatsApp"
                  name="phone"
                  placeholder="(85) 9 9999-9999"
                  required={false}
                />
              </>
            )}
            <AuthField
              icon={<UserRound />}
              label="Usuário"
              name="username"
              placeholder="Ex.: administrador"
              autoComplete="username"
            />
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-bold text-slate-700"
              >
                Senha
              </label>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  name="password"
                  type={show ? 'text' : 'password'}
                  minLength={8}
                  required
                  autoComplete={
                    firstAccess ? 'new-password' : 'current-password'
                  }
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  placeholder="Mínimo de 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button
              disabled={busy}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-sky-600 text-sm font-extrabold text-white shadow-[0_10px_28px_rgba(2,132,199,.22)] hover:bg-sky-700 disabled:opacity-60"
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : firstAccess ? (
                'Criar administrador'
              ) : (
                'Entrar'
              )}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">
            Acesso somente para usuários cadastrados.
          </p>
        </div>
      </section>
    </main>
  );
}

const subscribeToHydration = () => () => {};

function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}

function AuthField({
  icon,
  label,
  ...props
}: { icon: React.ReactNode; label: string } & React.ComponentProps<'input'>) {
  return (
    <div>
      <label
        htmlFor={String(props.name)}
        className="mb-1.5 block text-sm font-bold text-slate-700"
      >
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 [&_svg]:size-4">
          {icon}
        </span>
        <input
          id={String(props.name)}
          required={props.required !== false}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          {...props}
        />
      </div>
    </div>
  );
}
